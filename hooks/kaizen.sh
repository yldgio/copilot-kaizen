#!/bin/sh
# SOURCE: this file is copied to .github/hooks/kaizen/ by `kaizen install`.
# End-users: do not edit .github/hooks/kaizen/kaizen.sh — run `kaizen update` to refresh.
# Contributors: edit hooks/kaizen.sh in the kaizen repo, then run `kaizen update .` locally.
#
# Hook wrapper for copilot-kaizen on Unix/macOS.
# Called by Copilot CLI via .github/hooks/kaizen.json.
#
# Protocol:
#   preToolUse  → stdout = JSON from kaizen hook
#   all others  → stdout = empty (fire-and-forget)
#
# INVARIANT: Never fails — all errors suppressed (|| true, 2>/dev/null).
# INVARIANT: Calls `kaizen` from PATH — no embedded paths.
# NOTE: Uses #!/bin/sh (POSIX sh) intentionally — more portable and faster than bash.

EVENT="${1:-}"

# No event argument → exit silently
[ -z "$EVENT" ] && exit 0

# Skip all processing if requested
[ -n "${SKIP_KAIZEN:-}" ] && exit 0

# Read all of stdin into a variable
INPUT="$(cat)"

if [ "$EVENT" = "preToolUse" ]; then
  # preToolUse: capture stdout (the JSON response)
  RESULT="$(echo "$INPUT" | kaizen hook "$EVENT" 2>/dev/null)"
  if [ -n "$RESULT" ]; then
    printf '%s' "$RESULT"
  else
    printf '{"permissionDecision":"allow"}'
  fi
else
  # All other events: fire-and-forget, suppress all output
  echo "$INPUT" | kaizen hook "$EVENT" 2>/dev/null || true
fi
