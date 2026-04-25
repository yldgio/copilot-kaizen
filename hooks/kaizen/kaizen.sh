#!/usr/bin/env bash
# kaizen.sh — Kaizen hook handler (bash)
# Platform: Linux / macOS / Windows+GitBash
# Events: sessionStart, userPromptSubmitted, preToolUse, postToolUse, errorOccurred, sessionEnd
#
# Non-blocking by design: all SQLite writes are dispatched to a background
# subshell ( ... ) & so this script exits in milliseconds. If sqlite3 is
# unavailable or any write fails, the script exits 0 silently.

set -euo pipefail

# Crash-to-success: any unhandled error exits 0 so we never block the agent.
trap 'exit 0' ERR

# ── Configuration ────────────────────────────────────────────────────────────

EVENT="${1:-}"
[[ -z "$EVENT" ]] && exit 0

# Honour kill-switch
[[ "${SKIP_KAIZEN:-}" == "1" ]] && exit 0

GLOBAL_DB="${HOME}/.copilot/kaizen.db"
KAIZEN_SESSION_FILE="${TMPDIR:-/tmp}/kaizen_session_id"

# Ensure the global DB directory exists
mkdir -p "$(dirname "$GLOBAL_DB")" 2>/dev/null || true

# Bail out silently if sqlite3 is not available
command -v sqlite3 &>/dev/null || exit 0

# ── Schema ───────────────────────────────────────────────────────────────────

_init_db() {
    local db="$1"
    sqlite3 "$db" "
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS kaizen_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    scope        TEXT NOT NULL,
    category     TEXT NOT NULL,
    content      TEXT NOT NULL,
    source       TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    last_seen    TEXT DEFAULT (datetime('now')),
    hit_count    INTEGER DEFAULT 1,
    crystallized INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_tool_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    tool_name  TEXT,
    result     TEXT,
    ts         TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kaizen_sessions (
    session_id    TEXT PRIMARY KEY,
    repo          TEXT,
    started_at    TEXT DEFAULT (datetime('now')),
    ended_at      TEXT,
    source        TEXT,
    end_reason    TEXT,
    tool_count    INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    prompt_count  INTEGER DEFAULT 0,
    error_count   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kaizen_procedures (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id        INTEGER REFERENCES kaizen_entries(id),
    category        TEXT,
    content         TEXT,
    scope           TEXT,
    crystallized_at TEXT DEFAULT (datetime('now')),
    applied_count   INTEGER DEFAULT 0,
    exported        INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ke_scope        ON kaizen_entries(scope);
CREATE INDEX IF NOT EXISTS idx_ke_category     ON kaizen_entries(category);
CREATE INDEX IF NOT EXISTS idx_ke_crystallized ON kaizen_entries(crystallized);
CREATE INDEX IF NOT EXISTS idx_kp_exported     ON kaizen_procedures(exported);

-- Unique key enables atomic ON CONFLICT upserts for errorOccurred
CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_upsert ON kaizen_entries(category, content);
" 2>/dev/null || true

    # Phase 2: add last_applied_at (idempotent — fails silently if column exists)
    sqlite3 "$db" "ALTER TABLE kaizen_procedures ADD COLUMN last_applied_at TEXT;" 2>/dev/null || true
}

# ── JSON parsing ─────────────────────────────────────────────────────────────
#
# Priority: jq → python3/python → sed (top-level string fields only).
# For deeply nested paths (e.g. .toolResult.resultType), sed returns empty
# string — the hook still exits 0; no data is recorded for that field.

_json_get() {
    local json="$1" path="$2"
    if command -v jq &>/dev/null; then
        printf '%s' "$json" | jq -r "$path // empty" 2>/dev/null || true
        return
    fi
    local py_cmd=""
    command -v python3 &>/dev/null && py_cmd="python3"
    command -v python  &>/dev/null && [[ -z "$py_cmd" ]] && py_cmd="python"
    if [[ -n "$py_cmd" ]]; then
        # Pass JSON and path via env vars — pipe+heredoc clash (heredoc wins stdin)
        KAIZEN_JSON="$json" KAIZEN_PATH="$path" "$py_cmd" - 2>/dev/null <<'PYEOF' || true
import sys, json, os
try:
    d = json.loads(os.environ.get('KAIZEN_JSON', '{}'))
    path = os.environ.get('KAIZEN_PATH', '').lstrip('.')
    v = d
    for k in path.split('.'):
        if k:
            v = v.get(k, '') if isinstance(v, dict) else ''
    print('' if v is None else v)
except Exception:
    pass
PYEOF
        return
    fi
    # Sed fallback: top-level string fields only
    local field="${path#.}"
    printf '%s' "$json" | \
        sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | \
        head -1
}

# ── Helpers ───────────────────────────────────────────────────────────────────

_sql_escape() {
    local s="${1//\'/\'\'}"   # escape single quotes
    s="${s//$'\n'/ }"         # replace newlines with spaces (prevent SQL injection)
    s="${s//$'\r'/ }"         # replace carriage returns
    printf '%s' "$s"
}

_read_session_id() {
    [[ -f "$KAIZEN_SESSION_FILE" ]] && cat "$KAIZEN_SESSION_FILE" || true
}

# ── Read stdin ────────────────────────────────────────────────────────────────

INPUT="$(cat)"

# Derive a per-project session file path from the CWD in the incoming JSON.
# Using a CWD-keyed name prevents concurrent sessions in different directories
# from overwriting each other's session ID.
_input_cwd="$(_json_get "$INPUT" ".cwd")"
_cwd_key="$(basename "${_input_cwd:-.}" | tr -cs '[:alnum:]' '_' | head -c 24)"
[[ -z "$_cwd_key" ]] && _cwd_key="root"
KAIZEN_SESSION_FILE="${TMPDIR:-/tmp}/kaizen_session_${_cwd_key}"

# Initialize global DB synchronously (idempotent, fast after first run)
_init_db "$GLOBAL_DB"

# ── Handlers ──────────────────────────────────────────────────────────────────

_handle_session_start() {
    local source cwd repo session_id

    source="$(_json_get "$INPUT" ".source")"
    cwd="$(_json_get "$INPUT" ".cwd")"

    session_id="$(date +%Y%m%dT%H%M%S)_$$"

    # Derive repo: prefer git remote, fall back to directory name
    repo="$(basename "${cwd:-.}" 2>/dev/null || echo "unknown")"
    if command -v git &>/dev/null; then
        local remote
        remote="$(git -C "${cwd:-.}" remote get-url origin 2>/dev/null | \
                  sed 's|.*/||;s|\.git$||' || true)"
        [[ -n "$remote" ]] && repo="$remote"
    fi

    local repo_esc source_esc sid_esc
    repo_esc="$(_sql_escape "$repo")"
    source_esc="$(_sql_escape "$source")"
    sid_esc="$(_sql_escape "$session_id")"

    # Write session_id synchronously — subsequent hooks need it
    printf '%s' "$session_id" > "$KAIZEN_SESSION_FILE"

    if [[ "$source" != "resume" ]]; then
        # Synchronous: insert session row immediately so early counter updates land
        sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
INSERT OR IGNORE INTO kaizen_sessions (session_id, repo, source, started_at)
VALUES ('${sid_esc}', '${repo_esc}', '${source_esc}', datetime('now'));
" 2>/dev/null || true

        # Background: auto-crystallize high-signal entries (not time-critical)
        (
            sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
INSERT INTO kaizen_procedures (entry_id, category, content, scope)
SELECT id, category, content, scope FROM kaizen_entries
WHERE hit_count >= 10 AND crystallized = 0;

UPDATE kaizen_entries SET crystallized = 1
WHERE hit_count >= 10 AND crystallized = 0;
" 2>/dev/null
        ) &
        disown $!
    fi

    # Synchronous read of top observations for agent context
    local entries local_entries all_entries obs_count

    entries="$(sqlite3 "$GLOBAL_DB" "
SELECT category || ': ' || content FROM kaizen_entries
ORDER BY hit_count DESC, last_seen DESC LIMIT 5;
" 2>/dev/null || true)"

    local_entries=""
    if [[ -f ".kaizen/kaizen.db" ]]; then
        local_entries="$(sqlite3 ".kaizen/kaizen.db" "
SELECT category || ': ' || content FROM kaizen_entries
ORDER BY hit_count DESC, last_seen DESC LIMIT 5;
" 2>/dev/null || true)"
    fi

    all_entries="${entries}"
    [[ -n "$local_entries" ]] && all_entries="${all_entries}
${local_entries}"

    obs_count=0
    if [[ -n "$all_entries" ]]; then
        obs_count="$(printf '%s\n' "$all_entries" | grep -c .)" || obs_count=0
    fi

    # Phase 2: query crystallized procedures (hybrid: 3 unvalidated + 2 proven)
    local procs_unvalidated procs_proven all_procs proc_count
    procs_unvalidated="$(sqlite3 "$GLOBAL_DB" "
SELECT id || '|' || category || ': ' || content FROM kaizen_procedures
WHERE applied_count = 0
ORDER BY crystallized_at DESC LIMIT 3;
" 2>/dev/null || true)"

    procs_proven="$(sqlite3 "$GLOBAL_DB" "
SELECT id || '|' || category || ': ' || content FROM kaizen_procedures
WHERE applied_count > 0
ORDER BY last_applied_at DESC LIMIT 2;
" 2>/dev/null || true)"

    all_procs="${procs_unvalidated}"
    [[ -n "$procs_proven" ]] && { [[ -n "$all_procs" ]] && all_procs="${all_procs}
${procs_proven}" || all_procs="${procs_proven}"; }

    proc_count=0
    if [[ -n "$all_procs" ]]; then
        proc_count="$(printf '%s\n' "$all_procs" | grep -c .)" || proc_count=0
    fi

    # Print combined summary
    printf '⚡ Kaizen — %d procedures, %d observations\n' "$proc_count" "$obs_count"
    if [[ -n "$all_procs" ]]; then
        while IFS= read -r line; do
            if [[ -n "$line" ]]; then
                local p_id="${line%%|*}"
                local p_text="${line#*|}"
                printf '  📋 [%s] %s\n' "$p_id" "$p_text"
            fi
        done <<< "$all_procs"
    fi
    if [[ -n "$all_entries" ]]; then
        while IFS= read -r line; do
            [[ -n "$line" ]] && printf '  • %s\n' "$line"
        done <<< "$all_entries"
    fi
    if [[ "$proc_count" -gt 0 ]]; then
        printf 'Mark a procedure as applied: kaizen-mark --applied <id>\n'
    fi
}

_handle_user_prompt_submitted() {
    local session_id
    session_id="$(_read_session_id)"
    [[ -z "$session_id" ]] && return

    local sid_esc
    sid_esc="$(_sql_escape "$session_id")"

    (
        sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
UPDATE kaizen_sessions SET prompt_count = prompt_count + 1
WHERE session_id = '${sid_esc}';" 2>/dev/null
    ) &
    disown $!
}

_handle_pre_tool_use() {
    local session_id tool_name
    session_id="$(_read_session_id)"
    [[ -z "$session_id" ]] && return

    tool_name="$(_json_get "$INPUT" ".toolName")"

    local sid_esc tn_esc
    sid_esc="$(_sql_escape "$session_id")"
    tn_esc="$(_sql_escape "$tool_name")"

    (
        sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
INSERT INTO kaizen_tool_log (session_id, tool_name, result, ts)
VALUES ('${sid_esc}', '${tn_esc}', 'pre', datetime('now'));" 2>/dev/null
    ) &
    disown $!
}

_handle_post_tool_use() {
    local session_id tool_name result_type
    session_id="$(_read_session_id)"
    [[ -z "$session_id" ]] && return

    tool_name="$(_json_get "$INPUT" ".toolName")"
    result_type="$(_json_get "$INPUT" ".toolResult.resultType")"

    local sid_esc tn_esc rt_esc
    sid_esc="$(_sql_escape "$session_id")"
    tn_esc="$(_sql_escape "$tool_name")"
    rt_esc="$(_sql_escape "$result_type")"

    (
        sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
INSERT INTO kaizen_tool_log (session_id, tool_name, result, ts)
VALUES ('${sid_esc}', '${tn_esc}', '${rt_esc}', datetime('now'));" 2>/dev/null
    ) &
    disown $!
}

_handle_error_occurred() {
    local session_id error_name error_msg content
    session_id="$(_read_session_id)"
    [[ -z "$session_id" ]] && return

    error_name="$(_json_get "$INPUT" ".error.name")"
    error_msg="$(_json_get "$INPUT" ".error.message")"
    content="[${error_name}] ${error_msg}"

    local sid_esc content_esc
    sid_esc="$(_sql_escape "$session_id")"
    content_esc="$(_sql_escape "$content")"

    (
        sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
-- Atomic upsert: UNIQUE(category,content) index makes this concurrency-safe
INSERT INTO kaizen_entries (scope, category, content, source, hit_count)
VALUES ('global', 'mistake', '${content_esc}', '${sid_esc}', 1)
ON CONFLICT(category, content) DO UPDATE SET
    hit_count = hit_count + 1,
    last_seen = datetime('now');

UPDATE kaizen_sessions SET error_count = error_count + 1
WHERE session_id = '${sid_esc}';" 2>/dev/null
    ) &
    disown $!
}

_handle_session_end() {
    local session_id reason
    session_id="$(_read_session_id)"
    [[ -z "$session_id" ]] && return

    reason="$(_json_get "$INPUT" ".reason")"

    local sid_esc reason_esc
    sid_esc="$(_sql_escape "$session_id")"
    reason_esc="$(_sql_escape "$reason")"

    # Synchronous count reads — needed for the printed summary
    local tool_count failure_count
    tool_count="$(sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
SELECT COUNT(*) FROM kaizen_tool_log
WHERE session_id = '${sid_esc}' AND result != 'pre';" 2>/dev/null || echo "0")"
    failure_count="$(sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
SELECT COUNT(*) FROM kaizen_tool_log
WHERE session_id = '${sid_esc}' AND result = 'failure';" 2>/dev/null || echo "0")"

    local do_decay=1
    [[ "$reason" == "abort" || "$reason" == "timeout" ]] && do_decay=0

    # Background: update session, record tool-failure patterns
    (
        sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
UPDATE kaizen_sessions
SET ended_at      = datetime('now'),
    end_reason    = '${reason_esc}',
    tool_count    = ${tool_count},
    failure_count = ${failure_count}
WHERE session_id = '${sid_esc}';

INSERT INTO kaizen_entries (scope, category, content, source, hit_count)
SELECT 'global',
       'tool_insight',
       'Tool ' || tool_name || ' failed ' || COUNT(*) || ' times in session ${sid_esc}',
       '${sid_esc}',
       1
FROM kaizen_tool_log
WHERE session_id = '${sid_esc}' AND result = 'failure'
GROUP BY tool_name
HAVING COUNT(*) > 2;" 2>/dev/null

        if [[ "${do_decay}" == "1" ]]; then
            sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
DELETE FROM kaizen_tool_log
WHERE ts < datetime('now', '-7 days');

DELETE FROM kaizen_entries
WHERE last_seen  < datetime('now', '-60 days')
  AND hit_count  < 3
  AND crystallized = 0;

-- Phase 2: procedure decay
DELETE FROM kaizen_procedures
WHERE applied_count = 0
  AND crystallized_at < datetime('now', '-90 days');

DELETE FROM kaizen_procedures
WHERE applied_count > 0
  AND last_applied_at < datetime('now', '-60 days');" 2>/dev/null
        fi
    ) &
    disown $!

    local skip_note=""
    [[ "${do_decay}" == "0" ]] && skip_note=" [skipped: decay/compact (${reason})]"

    printf '⚡ Kaizen — tools: %s, failures: %s%s\n' \
        "${tool_count:-0}" "${failure_count:-0}" "$skip_note"

    rm -f "$KAIZEN_SESSION_FILE" 2>/dev/null || true
}

# ── Dispatch ──────────────────────────────────────────────────────────────────

case "$EVENT" in
    sessionStart)         _handle_session_start ;;
    userPromptSubmitted)  _handle_user_prompt_submitted ;;
    preToolUse)           _handle_pre_tool_use ;;
    postToolUse)          _handle_post_tool_use ;;
    errorOccurred)        _handle_error_occurred ;;
    sessionEnd)           _handle_session_end ;;
    *) ;;
esac

exit 0
