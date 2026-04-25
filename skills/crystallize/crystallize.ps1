# crystallize.ps1 — Reorganize Kaizen memory files and print merged index
$ErrorActionPreference = 'SilentlyContinue'

# Find the hooks directory (relative to this script)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$hooksScript = Join-Path $scriptDir '..\..\hooks\kaizen\kaizen.ps1'

# Run reorganize on global + local memory
if (Test-Path $hooksScript) {
    & pwsh $hooksScript reorganize
} else {
    Write-Output "$([char]0x26A0) Could not find kaizen.ps1 for reorganize"
}

# Print merged index
$globalIdx = Join-Path $HOME '.copilot' 'kaizen' 'kaizen.md'
$localIdx  = Join-Path '.' '.kaizen' 'kaizen.md'

if ((Test-Path $globalIdx) -or (Test-Path $localIdx)) {
    Write-Output ''
    Write-Output "$([char]0x1F4DA) Merged Kaizen Memory Index:"
    Write-Output ''
    if (Test-Path $globalIdx) {
        Write-Output "$([char]0x2014) Global $([char]0x2014)"
        Get-Content $globalIdx -Encoding UTF8 | Write-Output
        Write-Output ''
    }
    if (Test-Path $localIdx) {
        Write-Output "$([char]0x2014) Local $([char]0x2014)"
        Get-Content $localIdx -Encoding UTF8 | Write-Output
        Write-Output ''
    }
    Write-Output "$([char]0x1F4CB) Memory reorganized. Review .kaizen/ and git add .kaizen/*.md"
} else {
    Write-Output "$([char]0x1F4CB) No memory files found yet. Procedures crystallize automatically as observations cross hit_count >= 10."
}
