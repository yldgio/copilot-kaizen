#!/usr/bin/env bash
# crystallize.sh — Export kaizen_procedures to .kaizen/procedures/<category>.md
set -euo pipefail
trap 'exit 0' ERR

GLOBAL_DB="${HOME}/.copilot/kaizen.db"

# Bail silently if sqlite3 or DB missing
command -v sqlite3 &>/dev/null || exit 0
[[ -f "$GLOBAL_DB" ]] || exit 0

# Get distinct unexported categories (Bash 3-compatible — no declare -A)
categories="$(sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
SELECT DISTINCT category FROM kaizen_procedures
WHERE exported = 0
ORDER BY category;
" 2>/dev/null || true)"

[[ -z "$categories" ]] && exit 0

mkdir -p ".kaizen/procedures" 2>/dev/null || true

today="$(date +%Y-%m-%d)"
all_ids=""
exported_count=0

while IFS= read -r cat; do
    [[ -z "$cat" ]] && continue

    # Sanitize: only alphanumeric, underscores, hyphens allowed in filename
    safe_cat="$(printf '%s' "$cat" | tr -c 'A-Za-z0-9_-' '_')"
    [[ -z "$safe_cat" ]] && continue

    # SQL-escape the category value for the WHERE clause
    sql_cat="$(printf '%s' "$cat" | sed "s/'/''/g")"

    # Query rows for this category
    rows="$(sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
SELECT id || '|' || content FROM kaizen_procedures
WHERE category = '${sql_cat}' AND exported = 0
ORDER BY crystallized_at;
" 2>/dev/null || true)"
    [[ -z "$rows" ]] && continue

    # Build file content and collect IDs (two passes over rows; no assoc arrays)
    cat_ids=""
    row_count=0
    file_content="$(
        printf '# Kaizen Procedures — %s\n\n' "$cat"
        printf 'Auto-generated from observations with hit_count ≥ 10.\n'
        printf 'Last updated: %s\n\n' "$today"
        while IFS= read -r row; do
            [[ -z "$row" ]] && continue
            printf -- '- %s\n' "${row#*|}"
        done <<< "$rows"
    )"
    while IFS= read -r row; do
        [[ -z "$row" ]] && continue
        cat_ids="${cat_ids}${row%%|*},"
        row_count=$((row_count + 1))
    done <<< "$rows"

    cat_file=".kaizen/procedures/${safe_cat}.md"
    printf '%s' "$file_content" > "$cat_file" 2>/dev/null || continue

    # File written successfully — record IDs and count procedure rows
    all_ids="${all_ids}${cat_ids}"
    exported_count=$((exported_count + row_count))
done <<< "$categories"

# Mark all exported rows
all_ids="${all_ids%,}"
if [[ -n "$all_ids" ]]; then
    sqlite3 "$GLOBAL_DB" "
PRAGMA busy_timeout=5000;
UPDATE kaizen_procedures SET exported = 1 WHERE id IN (${all_ids});
" 2>/dev/null || true
fi

printf '📋 Exported %d procedures to .kaizen/procedures/\n' "$exported_count"
