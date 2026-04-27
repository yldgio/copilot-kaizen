# SOURCE: this file is copied to .github/hooks/kaizen/ by `kaizen install`.
# End-users: do not edit .github/hooks/kaizen/kaizen.ps1 - run `kaizen update` to refresh.
# Contributors: edit hooks/kaizen.ps1 in the kaizen repo, then run `kaizen update .` locally.
#
# Hook wrapper for copilot-kaizen on Windows.
# Called by Copilot CLI via .github/hooks/kaizen.json.
#
# Protocol:
#   preToolUse  -> stdout = JSON from kaizen hook
#   all others  -> stdout = empty (fire-and-forget)
#
# INVARIANT: Never fails - all errors suppressed.
# INVARIANT: Calls `kaizen` from PATH - no embedded paths.

param(
  [string]$Event = ''
)

# No event argument -> exit silently
if (-not $Event) { exit 0 }

# Skip all processing if requested
if ($env:SKIP_KAIZEN) { return }

# Read all of stdin
$input_data = [Console]::In.ReadToEnd()

if ($Event -eq 'preToolUse') {
  # preToolUse: capture stdout (the JSON response)
  try {
    $result = $input_data | kaizen hook $Event 2>$null
    if ($result) {
      Write-Output $result
    } else {
      Write-Output '{"permissionDecision":"allow"}'
    }
  } catch {
    # kaizen not found or threw — still allow
    Write-Output '{"permissionDecision":"allow"}'
  }
} else {
  # All other events: fire-and-forget, suppress errors
  try {
    $input_data | kaizen hook $Event 2>$null
  } catch {
    # Suppress
  }
}
