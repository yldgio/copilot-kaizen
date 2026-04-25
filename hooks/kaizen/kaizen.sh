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
    sqlite3 "$db" "PRAGMA busy_timeout=5000; ALTER TABLE kaizen_procedures ADD COLUMN last_applied_at TEXT;" 2>/dev/null || true

    # Phase 3: add columns to kaizen_entries for file-based memory
    sqlite3 "$db" "PRAGMA busy_timeout=5000; ALTER TABLE kaizen_entries ADD COLUMN applied_count INTEGER DEFAULT 0;" 2>/dev/null || true
    sqlite3 "$db" "PRAGMA busy_timeout=5000; ALTER TABLE kaizen_entries ADD COLUMN last_applied_at TEXT;" 2>/dev/null || true
    sqlite3 "$db" "PRAGMA busy_timeout=5000; ALTER TABLE kaizen_entries ADD COLUMN crystallized_at TEXT;" 2>/dev/null || true
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
KAIZEN_INJECTED_FILE="${TMPDIR:-/tmp}/kaizen_injected_${_cwd_key}"

# Initialize global DB synchronously (idempotent, fast after first run)
_init_db "$GLOBAL_DB"

# ── Memory file helpers ──────────────────────────────────────────────────────

# Write or update a single entry in a memory file.
# Args: scope category content hit_count created_at
# Routing: tool_insight → tools/{name}.md; mistake → general.md; else → domain/{cat}.md
_write_memory_entry() {
    local scope="$1" category="$2" content="$3" hit_count="$4" created_at="$5"
    local root target_file

    if [[ "$scope" == "global" ]]; then
        root="${HOME}/.copilot/kaizen"
    else
        root=".kaizen"
    fi

    local tool_name=""
    case "$category" in
        tool_insight)
            tool_name="$(printf '%s' "$content" | awk '{print $2}')"
            [[ -z "$tool_name" ]] && tool_name="unknown"
            target_file="${root}/tools/${tool_name}.md"
            ;;
        mistake)
            target_file="${root}/general.md"
            ;;
        *)
            local topic
            topic="$(printf '%s' "$category" | tr -c 'A-Za-z0-9_-' '_')"
            [[ -z "$topic" ]] && topic="misc"
            target_file="${root}/domain/${topic}.md"
            ;;
    esac

    mkdir -p "$(dirname "$target_file")" 2>/dev/null || return 1

    local date_str="${created_at:0:10}"
    [[ -z "$date_str" || "$date_str" == "null" ]] && date_str="$(date +%Y-%m-%d)"
    local entry_line="- [${date_str}] ${content}  (seen ${hit_count}x)"

    if [[ -f "$target_file" ]]; then
        # Check if content already exists — update hit count in-place
        if grep -qF "$content" "$target_file" 2>/dev/null; then
            local tmpf
            tmpf="$(mktemp)"
            while IFS= read -r fline || [[ -n "$fline" ]]; do
                if printf '%s' "$fline" | grep -qF "$content" 2>/dev/null; then
                    printf '%s\n' "$entry_line"
                else
                    printf '%s\n' "$fline"
                fi
            done < "$target_file" > "$tmpf"
            mv "$tmpf" "$target_file"
            return 0
        fi
    else
        # New file — write header
        local header
        case "$category" in
            tool_insight) header="${tool_name:-Tools}" ;;
            mistake)      header="General" ;;
            *)            header="$category" ;;
        esac
        printf '# %s\n' "$header" > "$target_file"
    fi

    printf '%s\n' "$entry_line" >> "$target_file"
    return 0
}

# Rebuild kaizen.md index from actual files present under a root directory.
# Args: root_directory
_rebuild_index() {
    local root="$1"
    [[ -d "$root" ]] || return 0
    local index_file="${root}/kaizen.md"
    local today
    today="$(date +%Y-%m-%d)"

    local output=""
    local file_count=0

    # general.md
    if [[ -f "${root}/general.md" ]]; then
        local c
        c="$(grep -c '^- \[' "${root}/general.md" 2>/dev/null)" || c=0
        if [[ "$c" -gt 0 ]]; then
            output+="- general.md — cross-project conventions and recorded mistakes (${c} entries)"$'\n'
            file_count=$((file_count + 1))
        fi
    fi

    # tools/*.md
    if [[ -d "${root}/tools" ]]; then
        for f in "${root}/tools/"*.md; do
            [[ -f "$f" ]] || continue
            local base
            base="$(basename "$f")"
            local c
            c="$(grep -c '^- \[' "$f" 2>/dev/null)" || c=0
            if [[ "$c" -gt 0 ]]; then
                output+="- tools/${base} — ${base%.md} tool insights (${c} entries)"$'\n'
                file_count=$((file_count + 1))
            fi
        done
    fi

    # domain/*.md
    if [[ -d "${root}/domain" ]]; then
        for f in "${root}/domain/"*.md; do
            [[ -f "$f" ]] || continue
            local base
            base="$(basename "$f")"
            local c
            c="$(grep -c '^- \[' "$f" 2>/dev/null)" || c=0
            if [[ "$c" -gt 0 ]]; then
                output+="- domain/${base} — ${base%.md} knowledge (${c} entries)"$'\n'
                file_count=$((file_count + 1))
            fi
        done
    fi

    if [[ "$file_count" -gt 0 ]]; then
        {
            printf '# Kaizen Memory Index\n'
            printf '<!-- Updated: %s -->\n\n' "$today"
            printf '%s' "$output"
        } > "$index_file"
    fi
}

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
        # Synchronous: insert session row
        sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
INSERT OR IGNORE INTO kaizen_sessions (session_id, repo, source, started_at)
VALUES ('${sid_esc}', '${repo_esc}', '${source_esc}', datetime('now'));
" 2>/dev/null || true

        # ── One-time migration: export kaizen_procedures to memory files ──
        local migration_rows
        migration_rows="$(sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
SELECT id || char(9) || category || char(9) || scope || char(9) || COALESCE(crystallized_at, datetime('now')) || char(9) || content
FROM kaizen_procedures WHERE exported = 0;
" 2>/dev/null || true)"

        if [[ -n "$migration_rows" ]]; then
            local mig_ids=""
            while IFS=$'\t' read -r mid mcat mscope mdate mcontent; do
                [[ -z "$mid" ]] && continue
                _write_memory_entry "$mscope" "$mcat" "$mcontent" "10" "$mdate"
                mig_ids="${mig_ids}${mid},"
            done <<< "$migration_rows"
            mig_ids="${mig_ids%,}"
            if [[ -n "$mig_ids" ]]; then
                sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
UPDATE kaizen_procedures SET exported = 1 WHERE id IN (${mig_ids});
" 2>/dev/null || true
            fi
        fi

        # ── Backfill applied_count from kaizen_procedures to kaizen_entries ──
        sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
UPDATE kaizen_entries SET
    applied_count = (SELECT kp.applied_count FROM kaizen_procedures kp WHERE kp.entry_id = kaizen_entries.id AND kp.applied_count > 0 LIMIT 1),
    last_applied_at = (SELECT kp.last_applied_at FROM kaizen_procedures kp WHERE kp.entry_id = kaizen_entries.id AND kp.applied_count > 0 LIMIT 1)
WHERE id IN (SELECT entry_id FROM kaizen_procedures WHERE applied_count > 0)
  AND COALESCE(applied_count, 0) = 0;
" 2>/dev/null || true

        # ── Crystallize eligible entries to memory files ──
        local cryst_rows
        cryst_rows="$(sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
SELECT id || char(9) || category || char(9) || scope || char(9) || hit_count || char(9) || created_at || char(9) || content
FROM kaizen_entries
WHERE hit_count >= 10 AND crystallized = 0;
" 2>/dev/null || true)"

        if [[ -n "$cryst_rows" ]]; then
            local cryst_ids=""
            while IFS=$'\t' read -r cid ccat cscope chit ccreated ccontent; do
                [[ -z "$cid" ]] && continue
                _write_memory_entry "$cscope" "$ccat" "$ccontent" "$chit" "$ccreated"
                cryst_ids="${cryst_ids}${cid},"
            done <<< "$cryst_rows"
            cryst_ids="${cryst_ids%,}"
            if [[ -n "$cryst_ids" ]]; then
                sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
UPDATE kaizen_entries SET crystallized = 1, crystallized_at = datetime('now')
WHERE id IN (${cryst_ids});
" 2>/dev/null || true
            fi
            _rebuild_index "${HOME}/.copilot/kaizen"
            _rebuild_index ".kaizen"
        fi
    fi

    # ── Build merged memory index ──
    local global_idx="${HOME}/.copilot/kaizen/kaizen.md"
    local local_idx=".kaizen/kaizen.md"
    local has_memory=0
    local merged_output="" file_count=0

    # Read local index first (takes precedence for same paths)
    local local_paths=""
    if [[ -f "$local_idx" ]]; then
        while IFS= read -r line; do
            [[ "$line" == "- "* ]] || continue
            local path="${line#- }"
            path="${path%% —*}"
            local_paths+="${path}"$'\n'
            merged_output+="  • [local] ${line#- }"$'\n'
            file_count=$((file_count + 1))
            has_memory=1
        done < "$local_idx"
    fi

    # Read global index, skip paths already in local
    if [[ -f "$global_idx" ]]; then
        while IFS= read -r line; do
            [[ "$line" == "- "* ]] || continue
            local path="${line#- }"
            path="${path%% —*}"
            if [[ -n "$local_paths" ]] && printf '%s' "$local_paths" | grep -qF "$path"; then
                continue
            fi
            merged_output+="  • ${line#- }"$'\n'
            file_count=$((file_count + 1))
            has_memory=1
        done < "$global_idx"
    fi

    # ── Query numbered crystallized entries from kaizen_entries ──
    local cryst_entries
    cryst_entries="$(sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
SELECT id || '|' || category || ': ' || content FROM kaizen_entries
WHERE crystallized = 1
ORDER BY COALESCE(last_applied_at, crystallized_at, last_seen) DESC LIMIT 5;
" 2>/dev/null || true)"

    local proc_count=0
    if [[ -n "$cryst_entries" ]]; then
        proc_count="$(printf '%s\n' "$cryst_entries" | grep -c .)" || proc_count=0
    fi

    # ── Print output ──
    if [[ "$has_memory" -eq 1 ]]; then
        printf '⚡ Kaizen — %d memory files | %d crystallized entries\n' "$file_count" "$proc_count"
        printf '📚 Memory index (global + local):\n'
        printf '%s' "$merged_output"
    else
        # Fallback: show top-5 raw observations (current behavior)
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

        printf '⚡ Kaizen — %d crystallized entries, %d observations\n' "$proc_count" "$obs_count"
        if [[ -n "$all_entries" ]]; then
            while IFS= read -r line; do
                [[ -n "$line" ]] && printf '  • %s\n' "$line"
            done <<< "$all_entries"
        fi
    fi

    # Always print numbered crystallized entries
    if [[ -n "$cryst_entries" ]]; then
        while IFS= read -r line; do
            if [[ -n "$line" ]]; then
                local p_id="${line%%|*}"
                local p_text="${line#*|}"
                printf '  📋 [%s] %s\n' "$p_id" "$p_text"
            fi
        done <<< "$cryst_entries"
    fi
    if [[ "$proc_count" -gt 0 ]]; then
        printf 'Mark an entry as applied: kaizen-mark --applied <id>\n'
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

    # ── Inject per-tool memory file (once per session per tool) ──
    if [[ -n "$tool_name" ]]; then
        local already_injected=0
        if [[ -f "$KAIZEN_INJECTED_FILE" ]] && grep -qxF "$tool_name" "$KAIZEN_INJECTED_FILE" 2>/dev/null; then
            already_injected=1
        fi

        if [[ "$already_injected" -eq 0 ]]; then
            local global_tool_file="${HOME}/.copilot/kaizen/tools/${tool_name}.md"
            local local_tool_file=".kaizen/tools/${tool_name}.md"
            local printed=0

            if [[ -f "$global_tool_file" ]] || [[ -f "$local_tool_file" ]]; then
                printf '📋 Kaizen memory for tool '\''%s'\'':\n' "$tool_name"
                # Print entries (lines starting with "- ["), cap at 50 lines
                if [[ -f "$global_tool_file" ]]; then
                    grep '^- \[' "$global_tool_file" 2>/dev/null | head -50 || true
                fi
                if [[ -f "$local_tool_file" ]]; then
                    grep '^- \[' "$local_tool_file" 2>/dev/null | head -50 || true
                fi
                printed=1
            fi

            if [[ "$printed" -eq 1 ]]; then
                printf '%s\n' "$tool_name" >> "$KAIZEN_INJECTED_FILE"
            fi
        fi
    fi

    # ── Log tool use (unchanged) ──
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

    # Background: update session, record tool-failure patterns, crystallize, decay
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

        # ── Crystallize entries that crossed threshold this session ──
        local end_cryst_rows
        end_cryst_rows="$(sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
SELECT id || char(9) || category || char(9) || scope || char(9) || hit_count || char(9) || created_at || char(9) || content
FROM kaizen_entries
WHERE hit_count >= 10 AND crystallized = 0;
" 2>/dev/null || true)"

        if [[ -n "$end_cryst_rows" ]]; then
            local end_cryst_ids=""
            while IFS=$'\t' read -r cid ccat cscope chit ccreated ccontent; do
                [[ -z "$cid" ]] && continue
                _write_memory_entry "$cscope" "$ccat" "$ccontent" "$chit" "$ccreated"
                end_cryst_ids="${end_cryst_ids}${cid},"
            done <<< "$end_cryst_rows"
            end_cryst_ids="${end_cryst_ids%,}"
            if [[ -n "$end_cryst_ids" ]]; then
                sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
UPDATE kaizen_entries SET crystallized = 1, crystallized_at = datetime('now')
WHERE id IN (${end_cryst_ids});
" 2>/dev/null || true
            fi
            _rebuild_index "${HOME}/.copilot/kaizen"
            _rebuild_index ".kaizen"
        fi

        # ── Decay/compact ──
        if [[ "${do_decay}" == "1" ]]; then
            sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
DELETE FROM kaizen_tool_log
WHERE ts < datetime('now', '-7 days');

DELETE FROM kaizen_entries
WHERE last_seen  < datetime('now', '-60 days')
  AND hit_count  < 3
  AND crystallized = 0
  AND COALESCE(applied_count, 0) = 0;

-- Legacy procedure decay (table retained for backward compat)
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

    rm -f "$KAIZEN_SESSION_FILE" "$KAIZEN_INJECTED_FILE" 2>/dev/null || true
}

# ── Reorganize handler ────────────────────────────────────────────────────

_handle_reorganize() {
    local global_root="${HOME}/.copilot/kaizen"
    local local_root=".kaizen"

    # Use python for robust dedup/merge if available
    local py_cmd=""
    command -v python3 &>/dev/null && py_cmd="python3"
    command -v python  &>/dev/null && [[ -z "$py_cmd" ]] && py_cmd="python"

    if [[ -n "$py_cmd" ]]; then
        "$py_cmd" - "$global_root" "$local_root" <<'PYEOF'
import sys, os, re
from collections import OrderedDict

global_root = sys.argv[1]
local_root = sys.argv[2]

def parse_entries(filepath):
    entries = []
    if not os.path.isfile(filepath):
        return entries
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            m = re.match(r'^- \[(\d{4}-\d{2}-\d{2})\] (.+?)  \(seen (\d+)x\)$', line)
            if m:
                entries.append({
                    'date': m.group(1),
                    'content': m.group(2),
                    'hit_count': int(m.group(3)),
                })
    return entries

def write_file(filepath, header, entries):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write('# {}\n'.format(header))
        for e in sorted(entries, key=lambda x: x['date'], reverse=True):
            f.write('- [{}] {}  (seen {}x)\n'.format(e['date'], e['content'], e['hit_count']))

summary = []

for root in [global_root, local_root]:
    if not os.path.isdir(root):
        continue
    for dirpath, dirs, files in os.walk(root):
        for fname in sorted(files):
            if fname == 'kaizen.md' or not fname.endswith('.md'):
                continue
            fpath = os.path.join(dirpath, fname)
            entries = parse_entries(fpath)
            if not entries:
                continue
            # Dedup by content — keep highest hit_count
            seen = OrderedDict()
            dups = 0
            for e in entries:
                key = e['content']
                if key in seen:
                    dups += 1
                    if e['hit_count'] > seen[key]['hit_count']:
                        seen[key] = e
                else:
                    seen[key] = e
            deduped = list(seen.values())
            rel = os.path.relpath(fpath, root)
            header = os.path.splitext(os.path.basename(fpath))[0]
            if header == 'general':
                header = 'General'
            if dups > 0:
                write_file(fpath, header, deduped)
            msg = '  * {}: {} entries'.format(rel, len(deduped))
            if dups > 0:
                msg += ' (removed {} duplicates)'.format(dups)
            summary.append(msg)

# Rebuild indexes
for root in [global_root, local_root]:
    if not os.path.isdir(root):
        continue
    index_path = os.path.join(root, 'kaizen.md')
    lines = []
    for dirpath, dirs, files in os.walk(root):
        for fname in sorted(files):
            if fname == 'kaizen.md' or not fname.endswith('.md'):
                continue
            fpath = os.path.join(dirpath, fname)
            count = len(parse_entries(fpath))
            if count == 0:
                continue
            rel = os.path.relpath(fpath, root)
            header = os.path.splitext(os.path.basename(fpath))[0]
            lines.append('- {} — {} ({} entries)'.format(rel, header, count))
    if lines:
        from datetime import date
        with open(index_path, 'w', encoding='utf-8') as f:
            f.write('# Kaizen Memory Index\n')
            f.write('<!-- Updated: {} -->\n\n'.format(date.today().isoformat()))
            for l in lines:
                f.write(l + '\n')
        label = 'global' if root == global_root else 'local'
        summary.append('  * kaizen.md: index updated ({} files) [{}]'.format(len(lines), label))

print('⚡ Kaizen reorganize complete')
for s in summary:
    print(s)
PYEOF
    else
        # Fallback: rebuild indexes only (no dedup without python)
        _rebuild_index "$global_root"
        _rebuild_index "$local_root"
        printf '⚡ Kaizen reorganize complete (index rebuilt, install python3 for full dedup)\n'
    fi
}

# ── Dispatch ──────────────────────────────────────────────────────────────────

case "$EVENT" in
    sessionStart)         _handle_session_start ;;
    userPromptSubmitted)  _handle_user_prompt_submitted ;;
    preToolUse)           _handle_pre_tool_use ;;
    postToolUse)          _handle_post_tool_use ;;
    errorOccurred)        _handle_error_occurred ;;
    sessionEnd)           _handle_session_end ;;
    reorganize)           _handle_reorganize ;;
    *) ;;
esac

exit 0
