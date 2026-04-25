# kaizen.ps1 — Kaizen hook handler (PowerShell)
# Platform: Windows (powershell.exe / pwsh), pwsh on Linux/macOS
# Events: sessionStart, userPromptSubmitted, preToolUse, postToolUse, errorOccurred, sessionEnd
#
# Non-blocking by design: all SQLite writes are dispatched via Start-Job so
# this script exits in milliseconds. If sqlite3 is unavailable or any write
# fails, the script exits 0 silently.

param([string]$Event = '')

# Crash-to-success: set a global error preference so exceptions don't bubble out
$ErrorActionPreference = 'SilentlyContinue'

# Honour kill-switch
if ($env:SKIP_KAIZEN -eq '1') { exit 0 }
if (-not $Event) { exit 0 }

# ── Paths ─────────────────────────────────────────────────────────────────────

$GLOBAL_DB = Join-Path $HOME '.copilot' 'kaizen.db'
$tmpDir = if ($env:TEMP) { $env:TEMP } elseif ($env:TMP) { $env:TMP } else { '/tmp' }
$KAIZEN_SESSION_FILE = Join-Path $tmpDir 'kaizen_session_id'

# Ensure global DB directory exists
$dbDir = Split-Path $GLOBAL_DB -Parent
if (-not (Test-Path $dbDir)) {
    New-Item -ItemType Directory -Path $dbDir -Force | Out-Null
}

# Bail out silently if sqlite3 is not available
if (-not (Get-Command sqlite3 -ErrorAction SilentlyContinue)) {
    Write-Warning '⚡ Kaizen: sqlite3 not found. Install via: winget install SQLite.SQLite'
    exit 0
}

# ── Schema ────────────────────────────────────────────────────────────────────

$SCHEMA_SQL = @'
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
'@

function Initialize-KaizenDB {
    param([string]$db)
    try { & sqlite3 $db $SCHEMA_SQL 2>&1 | Out-Null } catch {}
    # Phase 2: add last_applied_at (idempotent — fails silently if column exists)
    try { & sqlite3 $db "ALTER TABLE kaizen_procedures ADD COLUMN last_applied_at TEXT;" 2>&1 | Out-Null } catch {}
}

# ── Helpers ───────────────────────────────────────────────────────────────────

function Escape-Sql {
    param([string]$s)
    # Escape single quotes and normalize newlines to prevent SQL injection
    return ($s -replace "'", "''" -replace "`r`n|`r|`n", ' ')
}

# Dispatch a SQLite write to a fully independent subprocess (survives parent exit).
# Start-Job is NOT used because its jobs are killed when the PowerShell process exits.
function Start-KaizenWrite {
    param([string]$db, [string]$sql)
    try {
        $pi = [System.Diagnostics.ProcessStartInfo]::new()
        $pi.FileName = 'sqlite3'
        $pi.Arguments = "`"$db`""
        $pi.RedirectStandardInput  = $true
        $pi.RedirectStandardOutput = $true   # suppress pragma output leaking to our stdout
        $pi.RedirectStandardError  = $true
        $pi.UseShellExecute = $false
        $pi.CreateNoWindow  = $true
        $proc = [System.Diagnostics.Process]::Start($pi)
        $proc.StandardInput.WriteLine($sql)
        $proc.StandardInput.Close()
        # sqlite3 now holds all SQL input and runs to completion independently.
        # Redirect buffers are small (pragma results only); no blocking risk.
    } catch {}
}

function Get-SessionId {
    if (Test-Path $KAIZEN_SESSION_FILE) {
        return (Get-Content $KAIZEN_SESSION_FILE -Raw).Trim()
    }
    return ''
}

# ── Read stdin ────────────────────────────────────────────────────────────────

$inputData = $null
try {
    $raw = [Console]::In.ReadToEnd()
    $inputData = $raw | ConvertFrom-Json
} catch {
    exit 0
}
if (-not $inputData) { exit 0 }

# Derive a per-project session file path from the CWD in the incoming JSON.
# CWD-keyed name prevents concurrent sessions in different directories from
# overwriting each other's session ID.
$_inputCwd  = if ($inputData.cwd) { [string]$inputData.cwd } else { '.' }
$_cwdKey    = (Split-Path $_inputCwd -Leaf) -replace '[^a-zA-Z0-9]', '_'
if ($_cwdKey.Length -gt 24) { $_cwdKey = $_cwdKey.Substring($_cwdKey.Length - 24) }
if (-not $_cwdKey) { $_cwdKey = 'root' }
$KAIZEN_SESSION_FILE = Join-Path $tmpDir "kaizen_session_$_cwdKey"

# Initialize global DB synchronously (idempotent, fast after first run)
Initialize-KaizenDB $GLOBAL_DB

# ── Handlers ──────────────────────────────────────────────────────────────────

switch ($Event) {

    # ── sessionStart ─────────────────────────────────────────────────────────
    'sessionStart' {
        $source = [string]$inputData.source
        $cwd    = [string]$inputData.cwd

        $sessionId = [datetime]::UtcNow.ToString('yyyyMMddTHHmmss') + "_$PID"

        # Derive repo: prefer git remote, fall back to directory name
        $repo = Split-Path $cwd -Leaf
        try {
            $remote = (& git -C $cwd remote get-url origin 2>$null)
            if ($remote) {
                $repo = ($remote -split '[/\\]')[-1] -replace '\.git$', ''
            }
        } catch {}

        # Write session_id synchronously — subsequent hooks need it before exit
        Set-Content -Path $KAIZEN_SESSION_FILE -Value $sessionId -NoNewline

        if ($source -ne 'resume') {
            $sid      = Escape-Sql $sessionId
            $repoEsc  = Escape-Sql $repo
            $srcEsc   = Escape-Sql $source

            # Synchronous: insert session row immediately so early counter updates land
            try {
                & sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; INSERT OR IGNORE INTO kaizen_sessions (session_id, repo, source, started_at) VALUES ('$sid', '$repoEsc', '$srcEsc', datetime('now'));" 2>&1 | Out-Null
            } catch {}

            # Background: auto-crystallize high-signal entries (not time-critical)
            $sql = @"
PRAGMA busy_timeout=5000;
INSERT INTO kaizen_procedures (entry_id, category, content, scope)
SELECT id, category, content, scope FROM kaizen_entries
WHERE hit_count >= 10 AND crystallized = 0;

UPDATE kaizen_entries SET crystallized = 1
WHERE hit_count >= 10 AND crystallized = 0;
"@
            Start-KaizenWrite $GLOBAL_DB $sql
        }

        # Synchronous read of top observations for agent context
        $entries = @()
        try {
            $entries = & sqlite3 $GLOBAL_DB @'
SELECT category || ': ' || content FROM kaizen_entries
ORDER BY hit_count DESC, last_seen DESC LIMIT 5;
'@ 2>$null
        } catch {}

        $localEntries = @()
        $localDb = Join-Path $cwd '.kaizen' 'kaizen.db'
        if (Test-Path $localDb) {
            try {
                $localEntries = & sqlite3 $localDb @'
SELECT category || ': ' || content FROM kaizen_entries
ORDER BY hit_count DESC, last_seen DESC LIMIT 5;
'@ 2>$null
            } catch {}
        }

        $allEntries = @($entries) + @($localEntries) | Where-Object { $_ }
        $obsCount = $allEntries.Count

        # Phase 2: query crystallized procedures (hybrid: 3 unvalidated + 2 proven)
        $procsUnvalidated = @()
        try {
            $procsUnvalidated = & sqlite3 $GLOBAL_DB @'
SELECT id || '|' || category || ': ' || content FROM kaizen_procedures
WHERE applied_count = 0
ORDER BY crystallized_at DESC LIMIT 3;
'@ 2>$null
        } catch {}

        $procsProven = @()
        try {
            $procsProven = & sqlite3 $GLOBAL_DB @'
SELECT id || '|' || category || ': ' || content FROM kaizen_procedures
WHERE applied_count > 0
ORDER BY last_applied_at DESC LIMIT 2;
'@ 2>$null
        } catch {}

        $allProcs = @($procsUnvalidated) + @($procsProven) | Where-Object { $_ }
        $procCount = $allProcs.Count

        # Print combined summary
        Write-Output "⚡ Kaizen — $procCount procedures, $obsCount observations"
        foreach ($p in $allProcs) {
            $parts = $p -split '\|', 2
            $pId   = $parts[0]
            $pText = $parts[1]
            Write-Output "  📋 [$pId] $pText"
        }
        foreach ($e in $allEntries) {
            Write-Output "  • $e"
        }
        if ($procCount -gt 0) {
            Write-Output 'Mark a procedure as applied: kaizen-mark --applied <id>'
        }
    }

    # ── userPromptSubmitted ───────────────────────────────────────────────────
    'userPromptSubmitted' {
        $sessionId = Get-SessionId
        if (-not $sessionId) { exit 0 }

        $sid = Escape-Sql $sessionId
        $gdb = $GLOBAL_DB
        Start-KaizenWrite $gdb "PRAGMA busy_timeout=5000; UPDATE kaizen_sessions SET prompt_count = prompt_count + 1 WHERE session_id = '$sid';"
    }

    # ── preToolUse ────────────────────────────────────────────────────────────
    'preToolUse' {
        $sessionId = Get-SessionId
        if (-not $sessionId) { exit 0 }

        $toolName = [string]$inputData.toolName
        $sid = Escape-Sql $sessionId
        $tn  = Escape-Sql $toolName
        Start-KaizenWrite $GLOBAL_DB "PRAGMA busy_timeout=5000; INSERT INTO kaizen_tool_log (session_id, tool_name, result, ts) VALUES ('$sid', '$tn', 'pre', datetime('now'));"
    }

    # ── postToolUse ───────────────────────────────────────────────────────────
    'postToolUse' {
        $sessionId = Get-SessionId
        if (-not $sessionId) { exit 0 }

        $toolName   = [string]$inputData.toolName
        $resultType = [string]$inputData.toolResult.resultType
        $sid = Escape-Sql $sessionId
        $tn  = Escape-Sql $toolName
        $rt  = Escape-Sql $resultType
        Start-KaizenWrite $GLOBAL_DB "PRAGMA busy_timeout=5000; INSERT INTO kaizen_tool_log (session_id, tool_name, result, ts) VALUES ('$sid', '$tn', '$rt', datetime('now'));"
    }

    # ── errorOccurred ─────────────────────────────────────────────────────────
    'errorOccurred' {
        $sessionId = Get-SessionId
        if (-not $sessionId) { exit 0 }

        $errorName = [string]$inputData.error.name
        $errorMsg  = [string]$inputData.error.message
        $content   = "[$errorName] $errorMsg"

        $sid  = Escape-Sql $sessionId
        $cont = Escape-Sql $content

        $sql = @"
PRAGMA busy_timeout=5000;
-- Atomic upsert: UNIQUE(category,content) index makes this concurrency-safe
INSERT INTO kaizen_entries (scope, category, content, source, hit_count)
VALUES ('global', 'mistake', '$cont', '$sid', 1)
ON CONFLICT(category, content) DO UPDATE SET
    hit_count = hit_count + 1,
    last_seen = datetime('now');

UPDATE kaizen_sessions SET error_count = error_count + 1
WHERE session_id = '$sid';
"@
        Start-KaizenWrite $GLOBAL_DB $sql
    }

    # ── sessionEnd ────────────────────────────────────────────────────────────
    'sessionEnd' {
        $sessionId = Get-SessionId
        if (-not $sessionId) { exit 0 }

        $reason = [string]$inputData.reason
        $sid    = Escape-Sql $sessionId

        # Synchronous counts for the printed summary
        $toolCount    = 0
        $failureCount = 0
        try {
            $toolCount    = [int](& sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; SELECT COUNT(*) FROM kaizen_tool_log WHERE session_id = '$sid' AND result != 'pre';" 2>$null)
            $failureCount = [int](& sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; SELECT COUNT(*) FROM kaizen_tool_log WHERE session_id = '$sid' AND result = 'failure';" 2>$null)
        } catch {}

        $doDecay = ($reason -ne 'abort' -and $reason -ne 'timeout')
        $reasonEsc = Escape-Sql $reason

        $sql = @"
PRAGMA busy_timeout=5000;
UPDATE kaizen_sessions
SET ended_at      = datetime('now'),
    end_reason    = '$reasonEsc',
    tool_count    = $toolCount,
    failure_count = $failureCount
WHERE session_id = '$sid';

INSERT INTO kaizen_entries (scope, category, content, source, hit_count)
SELECT 'global',
       'tool_insight',
       'Tool ' || tool_name || ' failed ' || COUNT(*) || ' times in session $sid',
       '$sid',
       1
FROM kaizen_tool_log
WHERE session_id = '$sid' AND result = 'failure'
GROUP BY tool_name
HAVING COUNT(*) > 2;
"@
        if ($doDecay) {
            $sql += @'

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
  AND last_applied_at < datetime('now', '-60 days');
'@
        }
        Start-KaizenWrite $GLOBAL_DB $sql

        $skipNote = ''
        if (-not $doDecay) { $skipNote = " [skipped: decay/compact ($reason)]" }

        Write-Output "⚡ Kaizen — tools: $toolCount, failures: $failureCount$skipNote"

        Remove-Item -Path $KAIZEN_SESSION_FILE -Force -ErrorAction SilentlyContinue
    }
}

exit 0
