# kaizen-mark.ps1 — Mark a Kaizen procedure as applied
$ErrorActionPreference = 'SilentlyContinue'

$GLOBAL_DB = Join-Path $HOME '.copilot' 'kaizen.db'

# Bail silently if sqlite3 or DB missing
if (-not (Get-Command sqlite3 -ErrorAction SilentlyContinue)) { exit 0 }
if (-not (Test-Path $GLOBAL_DB)) { exit 0 }

# Parse --applied <id>
$id = $null
for ($i = 0; $i -lt $args.Count; $i++) {
    if ($args[$i] -eq '--applied' -and ($i + 1) -lt $args.Count) {
        $id = $args[$i + 1]
        break
    }
}

# Validate ID is a positive integer
if (-not $id) { exit 0 }
if ($id -notmatch '^\d+$') { exit 0 }
$idInt = [int]$id
if ($idInt -le 0) { exit 0 }

$changed = 0
try {
    $result = & sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; UPDATE kaizen_entries SET applied_count = COALESCE(applied_count, 0) + 1, last_applied_at = datetime('now') WHERE id = $idInt AND crystallized = 1; SELECT changes();" 2>$null
    $changed = [int]($result | Select-Object -Last 1)
} catch { exit 0 }

if ($changed -le 0) { exit 0 }

Write-Output "✅ Marked entry #$idInt as applied"
