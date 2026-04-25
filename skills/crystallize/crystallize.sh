#!/usr/bin/env bash
# crystallize.sh — Reorganize Kaizen memory files and print merged index
set -euo pipefail
trap 'exit 0' ERR

# Find the hooks directory (relative to this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="${SCRIPT_DIR}/../../hooks/kaizen"

# Run reorganize on global + local memory
if [[ -f "${HOOKS_DIR}/kaizen.sh" ]]; then
    bash "${HOOKS_DIR}/kaizen.sh" reorganize
else
    printf '⚠ Could not find kaizen.sh for reorganize\n'
fi

# Print merged index
global_idx="${HOME}/.copilot/kaizen/kaizen.md"
local_idx=".kaizen/kaizen.md"

if [[ -f "$global_idx" ]] || [[ -f "$local_idx" ]]; then
    printf '\n📚 Merged Kaizen Memory Index:\n\n'
    [[ -f "$global_idx" ]] && printf '— Global —\n' && cat "$global_idx" && printf '\n'
    [[ -f "$local_idx" ]]  && printf '— Local —\n'  && cat "$local_idx"  && printf '\n'
    printf '\n📋 Memory reorganized. Review .kaizen/ and git add .kaizen/*.md\n'
else
    printf '📋 No memory files found yet. Procedures crystallize automatically as observations cross hit_count ≥ 10.\n'
fi
