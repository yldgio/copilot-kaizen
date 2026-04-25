#!/usr/bin/env bash
# crystallize.sh — Export kaizen_procedures to .kaizen/procedures/<category>.md
set -euo pipefail
trap 'exit 0' ERR

GLOBAL_DB="${HOME}/.copilot/kaizen.db"

# Bail silently if sqlite3 or DB missing
command -v sqlite3 &>/dev/null || exit 0
[[ -f "$GLOBAL_DB" ]] || exit 0

# Query unexported procedures: "category|content"
rows="$(sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
SELECT id || '|' || category || '|' || content FROM kaizen_procedures
WHERE exported = 0
ORDER BY category, crystallized_at;
" 2>/dev/null || true)"

[[ -z "$rows" ]] && exit 0

# Group by category and write files
declare -A categories
declare -A category_ids
today="$(date +%Y-%m-%d)"

while IFS= read -r row; do
    [[ -z "$row" ]] && continue
    id="${row%%|*}"
    rest="${row#*|}"
    cat="${rest%%|*}"
    content="${rest#*|}"
    categories["$cat"]+="- ${content}
"
    category_ids["$cat"]+="${id},"
done <<< "$rows"

mkdir -p ".kaizen/procedures" 2>/dev/null || true

exported_count=0
all_ids=""
for cat in "${!categories[@]}"; do
    cat_file=".kaizen/procedures/${cat}.md"
    {
        printf '# Kaizen Procedures — %s\n\n' "$cat"
        printf 'Auto-generated from observations with hit_count ≥ 10.\n'
        printf 'Last updated: %s\n\n' "$today"
        printf '%s' "${categories[$cat]}"
    } > "$cat_file"
    all_ids+="${category_ids[$cat]}"
    exported_count=$((exported_count + 1))
done

# Mark all exported rows
all_ids="${all_ids%,}"  # remove trailing comma
if [[ -n "$all_ids" ]]; then
    sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
UPDATE kaizen_procedures SET exported = 1 WHERE id IN (${all_ids});
" 2>/dev/null || true
fi

printf '📋 Exported %d procedures to .kaizen/procedures/\n' "$exported_count"
