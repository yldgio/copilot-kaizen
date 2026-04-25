# crystallize.ps1 — Export kaizen_procedures to .kaizen/procedures/<category>.md
$ErrorActionPreference = 'SilentlyContinue'

$GLOBAL_DB = Join-Path $HOME '.copilot' 'kaizen.db'

# Bail silently if sqlite3 or DB missing
if (-not (Get-Command sqlite3 -ErrorAction SilentlyContinue)) { exit 0 }
if (-not (Test-Path $GLOBAL_DB)) { exit 0 }

# Query unexported procedures: "id|category|content"
$rows = @()
try {
    $rows = & sqlite3 $GLOBAL_DB @'
PRAGMA busy_timeout=5000;
SELECT id || '|' || category || '|' || content FROM kaizen_procedures
WHERE exported = 0
ORDER BY category, crystallized_at;
'@ 2>$null
} catch {}

$rows = @($rows) | Where-Object { $_ }
if ($rows.Count -eq 0) { exit 0 }

# Group by category; track IDs per category for safe per-file export marking
$groups   = @{}
$groupIds = @{}
$today = (Get-Date).ToString('yyyy-MM-dd')

foreach ($row in $rows) {
    $parts = $row -split '\|', 3
    $id      = $parts[0]
    $cat     = $parts[1]
    $content = $parts[2]
    if (-not $groups.ContainsKey($cat))   { $groups[$cat]   = @() }
    if (-not $groupIds.ContainsKey($cat)) { $groupIds[$cat] = @() }
    $groups[$cat]   += $content
    $groupIds[$cat] += $id
}

# Write files
$outDir = Join-Path '.' '.kaizen' 'procedures'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$exportedCount = 0
$successIds    = @()

foreach ($cat in $groups.Keys) {
    $catFile = Join-Path $outDir "$cat.md"
    $lines = @()
    $lines += "# Kaizen Procedures — $cat"
    $lines += ''
    $lines += 'Auto-generated from observations with hit_count ≥ 10.'
    $lines += "Last updated: $today"
    $lines += ''
    foreach ($c in $groups[$cat]) {
        $lines += "- $c"
    }
    try {
        $lines -join "`n" | Set-Content -Path $catFile -Encoding UTF8 -NoNewline -ErrorAction Stop
        # Only record IDs for categories whose file was successfully written
        $successIds += $groupIds[$cat]
        $exportedCount++
    } catch {}
}

# Mark only successfully-written rows as exported
if ($successIds.Count -gt 0) {
    $ids = $successIds -join ','
    try {
        & sqlite3 $GLOBAL_DB "PRAGMA busy_timeout=5000; UPDATE kaizen_procedures SET exported = 1 WHERE id IN ($ids);" 2>&1 | Out-Null
    } catch {}
}

Write-Output "📋 Exported $exportedCount procedures to .kaizen/procedures/"
