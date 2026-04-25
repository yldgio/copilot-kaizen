#!/usr/bin/env bash
# kaizen-mark.sh — Mark a Kaizen procedure as applied
set -euo pipefail
trap 'exit 0' ERR

GLOBAL_DB="${HOME}/.copilot/kaizen.db"

# Bail silently if sqlite3 or DB missing
command -v sqlite3 &>/dev/null || exit 0
[[ -f "$GLOBAL_DB" ]] || exit 0

# Parse --applied <id>
ID=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --applied)
            shift
            ID="${1:-}"
            shift || true
            ;;
        *)
            shift
            ;;
    esac
done

# Validate ID is a positive integer
[[ -z "$ID" ]] && exit 0
[[ "$ID" =~ ^[0-9]+$ ]] || exit 0
[[ "$ID" -gt 0 ]] || exit 0

changed="$(sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
UPDATE kaizen_entries
SET applied_count   = COALESCE(applied_count, 0) + 1,
    last_applied_at = datetime('now')
WHERE id = ${ID} AND crystallized = 1;
SELECT changes();
" 2>/dev/null || echo "0")"

[[ "${changed}" -gt 0 ]] || exit 0

printf '✅ Marked entry #%s as applied\n' "$ID"
