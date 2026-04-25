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
    try { & sqlite3 $db "PRAGMA busy_timeout=5000; ALTER TABLE kaizen_procedures ADD COLUMN last_applied_at TEXT;" 2>&1 | Out-Null } catch {}

    # Phase 3: add columns to kaizen_entries for file-based memory
    try { & sqlite3 $db "PRAGMA busy_timeout=5000; ALTER TABLE kaizen_entries ADD COLUMN applied_count INTEGER DEFAULT 0;" 2>&1 | Out-Null } catch {}
    try { & sqlite3 $db "PRAGMA busy_timeout=5000; ALTER TABLE kaizen_entries ADD COLUMN last_applied_at TEXT;" 2>&1 | Out-Null } catch {}
    try { & sqlite3 $db "PRAGMA busy_timeout=5000; ALTER TABLE kaizen_entries ADD COLUMN crystallized_at TEXT;" 2>&1 | Out-Null } catch {}
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
$KAIZEN_INJECTED_FILE = Join-Path $tmpDir "kaizen_injected_$_cwdKey"

# Initialize global DB synchronously (idempotent, fast after first run)
Initialize-KaizenDB $GLOBAL_DB

# ── Memory file helpers ──────────────────────────────────────────────────────

function Write-KaizenMemoryEntry {
    param(
        [string]$Scope,
        [string]$Category,
        [string]$Content,
        [int]$HitCount,
        [string]$CreatedAt
    )

    $root = if ($Scope -eq 'global') {
        Join-Path $HOME '.copilot' 'kaizen'
    } else {
        '.kaizen'
    }

    $toolName = ''
    switch ($Category) {
        'tool_insight' {
            $toolName = ($Content -split ' ')[1]
            if (-not $toolName) { $toolName = 'unknown' }
            $targetFile = Join-Path $root 'tools' "$toolName.md"
        }
        'mistake' {
            $targetFile = Join-Path $root 'general.md'
        }
        default {
            $topic = $Category -replace '[^A-Za-z0-9_\-]', '_'
            if (-not $topic) { $topic = 'misc' }
            $targetFile = Join-Path $root 'domain' "$topic.md"
        }
    }

    $dir = Split-Path $targetFile -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $dateStr = if ($CreatedAt -and $CreatedAt.Length -ge 10 -and $CreatedAt -ne 'null') {
        $CreatedAt.Substring(0, 10)
    } else {
        (Get-Date).ToString('yyyy-MM-dd')
    }
    $entryLine = "- [$dateStr] $Content  (seen ${HitCount}x)"

    if (Test-Path $targetFile) {
        $lines = @(Get-Content $targetFile -Encoding UTF8)
        $found = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i].Contains($Content)) {
                $lines[$i] = $entryLine
                $found = $true
                break
            }
        }
        if ($found) {
            $lines -join "`n" | Set-Content -Path $targetFile -Encoding UTF8 -NoNewline
            return
        }
    } else {
        $header = switch ($Category) {
            'tool_insight' { if ($toolName) { $toolName } else { 'Tools' } }
            'mistake'      { 'General' }
            default        { $Category }
        }
        "# $header" | Set-Content -Path $targetFile -Encoding UTF8 -NoNewline
    }

    "`n$entryLine" | Add-Content -Path $targetFile -Encoding UTF8 -NoNewline
}

function Rebuild-KaizenIndex {
    param([string]$Root)
    if (-not (Test-Path $Root)) { return }
    $indexFile = Join-Path $Root 'kaizen.md'
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $lines = @()

    # general.md
    $gf = Join-Path $Root 'general.md'
    if (Test-Path $gf) {
        $c = @(Select-String -Path $gf -Pattern '^\- \[' -ErrorAction SilentlyContinue).Count
        if ($c -gt 0) { $lines += "- general.md — cross-project conventions and recorded mistakes ($c entries)" }
    }

    # tools/*.md
    $toolsDir = Join-Path $Root 'tools'
    if (Test-Path $toolsDir) {
        foreach ($f in Get-ChildItem -Path $toolsDir -Filter '*.md' -File -ErrorAction SilentlyContinue) {
            $c = @(Select-String -Path $f.FullName -Pattern '^\- \[' -ErrorAction SilentlyContinue).Count
            if ($c -gt 0) { $lines += "- tools/$($f.Name) — $($f.BaseName) tool insights ($c entries)" }
        }
    }

    # domain/*.md
    $domainDir = Join-Path $Root 'domain'
    if (Test-Path $domainDir) {
        foreach ($f in Get-ChildItem -Path $domainDir -Filter '*.md' -File -ErrorAction SilentlyContinue) {
            $c = @(Select-String -Path $f.FullName -Pattern '^\- \[' -ErrorAction SilentlyContinue).Count
            if ($c -gt 0) { $lines += "- domain/$($f.Name) — $($f.BaseName) knowledge ($c entries)" }
        }
    }

    if ($lines.Count -gt 0) {
        $content = @("# Kaizen Memory Index", "<!-- Updated: $today -->", '') + $lines
        $content -join "`n" | Set-Content -Path $indexFile -Encoding UTF8 -NoNewline
    }
}

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

        # Write session_id synchronously
        Set-Content -Path $KAIZEN_SESSION_FILE -Value $sessionId -NoNewline

        if ($source -ne 'resume') {
            $sid      = Escape-Sql $sessionId
            $repoEsc  = Escape-Sql $repo
            $srcEsc   = Escape-Sql $source

            # Synchronous: insert session row
            try {
                & sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; INSERT OR IGNORE INTO kaizen_sessions (session_id, repo, source, started_at) VALUES ('$sid', '$repoEsc', '$srcEsc', datetime('now'));" 2>&1 | Out-Null
            } catch {}

            # ── One-time migration: export kaizen_procedures to memory files ──
            $migrationRows = @()
            try {
                $migrationRows = @(& sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; SELECT id || char(9) || category || char(9) || scope || char(9) || COALESCE(crystallized_at, datetime('now')) || char(9) || content FROM kaizen_procedures WHERE exported = 0;" 2>$null)
            } catch {}
            $migrationRows = @($migrationRows) | Where-Object { $_ }

            if ($migrationRows.Count -gt 0) {
                $migIds = @()
                foreach ($row in $migrationRows) {
                    $parts = $row -split "`t", 5
                    if ($parts.Count -lt 5) { continue }
                    Write-KaizenMemoryEntry -Scope $parts[2] -Category $parts[1] -Content $parts[4] -HitCount 10 -CreatedAt $parts[3]
                    $migIds += $parts[0]
                }
                if ($migIds.Count -gt 0) {
                    $ids = $migIds -join ','
                    try { & sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; UPDATE kaizen_procedures SET exported = 1 WHERE id IN ($ids);" 2>&1 | Out-Null } catch {}
                }
            }

            # ── Backfill applied_count from kaizen_procedures to kaizen_entries ──
            try {
                & sqlite3 $GLOBAL_DB @"
PRAGMA busy_timeout=5000;
UPDATE kaizen_entries SET
    applied_count = (SELECT kp.applied_count FROM kaizen_procedures kp WHERE kp.entry_id = kaizen_entries.id AND kp.applied_count > 0 LIMIT 1),
    last_applied_at = (SELECT kp.last_applied_at FROM kaizen_procedures kp WHERE kp.entry_id = kaizen_entries.id AND kp.applied_count > 0 LIMIT 1)
WHERE id IN (SELECT entry_id FROM kaizen_procedures WHERE applied_count > 0)
  AND COALESCE(applied_count, 0) = 0;
"@ 2>&1 | Out-Null
            } catch {}

            # ── Crystallize eligible entries to memory files ──
            $crystRows = @()
            try {
                $crystRows = @(& sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; SELECT id || char(9) || category || char(9) || scope || char(9) || hit_count || char(9) || created_at || char(9) || content FROM kaizen_entries WHERE hit_count >= 10 AND crystallized = 0;" 2>$null)
            } catch {}
            $crystRows = @($crystRows) | Where-Object { $_ }

            if ($crystRows.Count -gt 0) {
                $crystIds = @()
                foreach ($row in $crystRows) {
                    $parts = $row -split "`t", 6
                    if ($parts.Count -lt 6) { continue }
                    Write-KaizenMemoryEntry -Scope $parts[2] -Category $parts[1] -Content $parts[5] -HitCount ([int]$parts[3]) -CreatedAt $parts[4]
                    $crystIds += $parts[0]
                }
                if ($crystIds.Count -gt 0) {
                    $ids = $crystIds -join ','
                    try { & sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; UPDATE kaizen_entries SET crystallized = 1, crystallized_at = datetime('now') WHERE id IN ($ids);" 2>&1 | Out-Null } catch {}
                }
                Rebuild-KaizenIndex (Join-Path $HOME '.copilot' 'kaizen')
                Rebuild-KaizenIndex '.kaizen'
            }
        }

        # ── Build merged memory index ──
        $globalIdx = Join-Path $HOME '.copilot' 'kaizen' 'kaizen.md'
        $localIdx  = Join-Path '.' '.kaizen' 'kaizen.md'
        $hasMemory = $false
        $mergedOutput = @()
        $fileCount = 0

        # Read local index first (takes precedence)
        $localPaths = @()
        if (Test-Path $localIdx) {
            foreach ($line in Get-Content $localIdx -Encoding UTF8) {
                if ($line -match '^\- (.+?) —') {
                    $path = $Matches[1]
                    $localPaths += $path
                    $mergedOutput += "  $([char]0x2022) [local] $($line.Substring(2))"
                    $fileCount++
                    $hasMemory = $true
                }
            }
        }

        # Read global index, skip paths already in local
        if (Test-Path $globalIdx) {
            foreach ($line in Get-Content $globalIdx -Encoding UTF8) {
                if ($line -match '^\- (.+?) —') {
                    $path = $Matches[1]
                    if ($localPaths -contains $path) { continue }
                    $mergedOutput += "  $([char]0x2022) $($line.Substring(2))"
                    $fileCount++
                    $hasMemory = $true
                }
            }
        }

        # ── Query numbered crystallized entries from kaizen_entries ──
        $crystEntries = @()
        try {
            $crystEntries = @(& sqlite3 $GLOBAL_DB @'
PRAGMA busy_timeout=5000;
SELECT id || '|' || category || ': ' || content FROM kaizen_entries
WHERE crystallized = 1
ORDER BY COALESCE(last_applied_at, crystallized_at, last_seen) DESC LIMIT 5;
'@ 2>$null)
        } catch {}
        $crystEntries = @($crystEntries) | Where-Object { $_ }
        $procCount = $crystEntries.Count

        # ── Print output ──
        if ($hasMemory) {
            Write-Output "$([char]0x26A1) Kaizen — $fileCount memory files | $procCount crystallized entries"
            Write-Output "$([char]0x1F4DA) Memory index (global + local):"
            foreach ($m in $mergedOutput) { Write-Output $m }
        } else {
            # Fallback: show top-5 raw observations
            $entries = @()
            try {
                $entries = @(& sqlite3 $GLOBAL_DB @'
SELECT category || ': ' || content FROM kaizen_entries
ORDER BY hit_count DESC, last_seen DESC LIMIT 5;
'@ 2>$null)
            } catch {}

            $localEntries = @()
            $localDb = Join-Path $cwd '.kaizen' 'kaizen.db'
            if (Test-Path $localDb) {
                try {
                    $localEntries = @(& sqlite3 $localDb @'
SELECT category || ': ' || content FROM kaizen_entries
ORDER BY hit_count DESC, last_seen DESC LIMIT 5;
'@ 2>$null)
                } catch {}
            }

            $allEntries = @($entries) + @($localEntries) | Where-Object { $_ }
            $obsCount = $allEntries.Count

            Write-Output "$([char]0x26A1) Kaizen — $procCount crystallized entries, $obsCount observations"
            foreach ($e in $allEntries) {
                Write-Output "  $([char]0x2022) $e"
            }
        }

        # Always print numbered crystallized entries
        foreach ($p in $crystEntries) {
            $parts = $p -split '\|', 2
            $pId   = $parts[0]
            $pText = $parts[1]
            Write-Output "  $([char]0x1F4CB) [$pId] $pText"
        }
        if ($procCount -gt 0) {
            Write-Output 'Mark an entry as applied: kaizen-mark --applied <id>'
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

        # ── Inject per-tool memory file (once per session per tool) ──
        if ($toolName) {
            $alreadyInjected = $false
            if (Test-Path $KAIZEN_INJECTED_FILE) {
                $injected = @(Get-Content $KAIZEN_INJECTED_FILE -Encoding UTF8 -ErrorAction SilentlyContinue)
                if ($injected -contains $toolName) { $alreadyInjected = $true }
            }

            if (-not $alreadyInjected) {
                $globalToolFile = Join-Path $HOME '.copilot' 'kaizen' 'tools' "$toolName.md"
                $localToolFile  = Join-Path '.' '.kaizen' 'tools' "$toolName.md"
                $printed = $false

                if ((Test-Path $globalToolFile) -or (Test-Path $localToolFile)) {
                    Write-Output "$([char]0x1F4CB) Kaizen memory for tool '$toolName':"
                    if (Test-Path $globalToolFile) {
                        @(Select-String -Path $globalToolFile -Pattern '^\- \[' -ErrorAction SilentlyContinue) |
                            Select-Object -First 50 | ForEach-Object { Write-Output $_.Line }
                    }
                    if (Test-Path $localToolFile) {
                        @(Select-String -Path $localToolFile -Pattern '^\- \[' -ErrorAction SilentlyContinue) |
                            Select-Object -First 50 | ForEach-Object { Write-Output $_.Line }
                    }
                    $printed = $true
                }

                if ($printed) {
                    Add-Content -Path $KAIZEN_INJECTED_FILE -Value $toolName -Encoding UTF8
                }
            }
        }

        # ── Log tool use (unchanged) ──
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
        Start-KaizenWrite $GLOBAL_DB $sql

        # ── Crystallize entries that crossed threshold this session ──
        $endCrystRows = @()
        try {
            $endCrystRows = @(& sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; SELECT id || char(9) || category || char(9) || scope || char(9) || hit_count || char(9) || created_at || char(9) || content FROM kaizen_entries WHERE hit_count >= 10 AND crystallized = 0;" 2>$null)
        } catch {}
        $endCrystRows = @($endCrystRows) | Where-Object { $_ }

        if ($endCrystRows.Count -gt 0) {
            $endCrystIds = @()
            foreach ($row in $endCrystRows) {
                $parts = $row -split "`t", 6
                if ($parts.Count -lt 6) { continue }
                Write-KaizenMemoryEntry -Scope $parts[2] -Category $parts[1] -Content $parts[5] -HitCount ([int]$parts[3]) -CreatedAt $parts[4]
                $endCrystIds += $parts[0]
            }
            if ($endCrystIds.Count -gt 0) {
                $ids = $endCrystIds -join ','
                try { & sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; UPDATE kaizen_entries SET crystallized = 1, crystallized_at = datetime('now') WHERE id IN ($ids);" 2>&1 | Out-Null } catch {}
            }
            Rebuild-KaizenIndex (Join-Path $HOME '.copilot' 'kaizen')
            Rebuild-KaizenIndex '.kaizen'
        }

        # ── Decay/compact ──
        if ($doDecay) {
            $decaySql = @'
PRAGMA busy_timeout=5000;
DELETE FROM kaizen_tool_log
WHERE ts < datetime('now', '-7 days');

DELETE FROM kaizen_entries
WHERE last_seen  < datetime('now', '-60 days')
  AND hit_count  < 3
  AND crystallized = 0
  AND COALESCE(applied_count, 0) = 0;

-- Legacy procedure decay
DELETE FROM kaizen_procedures
WHERE applied_count = 0
  AND crystallized_at < datetime('now', '-90 days');

DELETE FROM kaizen_procedures
WHERE applied_count > 0
  AND last_applied_at < datetime('now', '-60 days');
'@
            Start-KaizenWrite $GLOBAL_DB $decaySql
        }

        $skipNote = ''
        if (-not $doDecay) { $skipNote = " [skipped: decay/compact ($reason)]" }

        Write-Output "$([char]0x26A1) Kaizen — tools: $toolCount, failures: $failureCount$skipNote"

        Remove-Item -Path $KAIZEN_SESSION_FILE -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $KAIZEN_INJECTED_FILE -Force -ErrorAction SilentlyContinue
    }

    # ── reorganize ───────────────────────────────────────────────────────────
    'reorganize' {
        $globalRoot = Join-Path $HOME '.copilot' 'kaizen'
        $localRoot  = '.kaizen'
        $summary    = @()

        foreach ($root in @($globalRoot, $localRoot)) {
            if (-not (Test-Path $root)) { continue }
            $mdFiles = @(Get-ChildItem -Path $root -Filter '*.md' -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -ne 'kaizen.md' })

            foreach ($f in $mdFiles) {
                $entries = @()
                foreach ($fline in (Get-Content $f.FullName -Encoding UTF8 -ErrorAction SilentlyContinue)) {
                    if ($fline -match '^\- \[(\d{4}-\d{2}-\d{2})\] (.+?)  \(seen (\d+)x\)$') {
                        $entries += @{ date = $Matches[1]; content = $Matches[2]; hit_count = [int]$Matches[3] }
                    }
                }
                if ($entries.Count -eq 0) { continue }

                # Dedup by content — keep highest hit_count
                $seen = [ordered]@{}
                $dups = 0
                foreach ($e in $entries) {
                    $key = $e.content
                    if ($seen.Contains($key)) {
                        $dups++
                        if ($e.hit_count -gt $seen[$key].hit_count) { $seen[$key] = $e }
                    } else {
                        $seen[$key] = $e
                    }
                }

                $rel = $f.FullName
                if ($f.FullName.StartsWith($root)) {
                    $rel = $f.FullName.Substring($root.Length).TrimStart('\', '/') -replace '\\', '/'
                }

                if ($dups -gt 0) {
                    $header = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
                    if ($header -eq 'general') { $header = 'General' }
                    $sorted = @($seen.Values) | Sort-Object { $_.date } -Descending
                    $content = @("# $header")
                    foreach ($e in $sorted) {
                        $content += "- [$($e.date)] $($e.content)  (seen $($e.hit_count)x)"
                    }
                    $content -join "`n" | Set-Content -Path $f.FullName -Encoding UTF8 -NoNewline
                }
                $msg = "  * ${rel}: $($seen.Count) entries"
                if ($dups -gt 0) { $msg += " (removed $dups duplicates)" }
                $summary += $msg
            }
        }

        # Rebuild indexes
        Rebuild-KaizenIndex $globalRoot
        Rebuild-KaizenIndex $localRoot
        $summary += "  * kaizen.md: index updated"

        Write-Output "$([char]0x26A1) Kaizen reorganize complete"
        foreach ($s in $summary) { Write-Output $s }
    }
}

exit 0
