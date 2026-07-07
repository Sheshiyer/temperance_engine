#!/usr/bin/env bash
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
S="$DIR/skills/temperance-parallel-dispatch/SKILL.md"
[[ -f "$S" ]] && echo "ok - SKILL.md exists" || { echo "FAIL - no SKILL.md"; fail=1; }
# frontmatter has exactly name + description keys
keys=$(awk '/^---$/{n++;next} n==1{print}' "$S" 2>/dev/null | grep -E '^[a-z_]+:' | sed 's/:.*//' | sort | tr '\n' ',')
[[ "$keys" == "description,name," ]] && echo "ok - frontmatter name+description" || { echo "FAIL - frontmatter keys: $keys"; fail=1; }
# install.sh references the skill dir
grep -q "temperance-parallel-dispatch" "$DIR/install.sh" && echo "ok - install.sh installs skill" || { echo "FAIL - install.sh missing skill"; fail=1; }
# skill-install block backs up an existing dest to TEMPERANCE_BACKUP_DIR before
# overwriting -- NOT to a sibling path inside ~/.claude/skills/, since that
# directory is scanned for skills and a sibling .bak dir would show up as a
# phantom skill.
block=$(awk '/Install temperance-parallel-dispatch skill/,/^fi$/' "$DIR/install.sh")
echo "$block" | grep -q 'TEMPERANCE_BACKUP_DIR' && echo "ok - skill-install block backs up to TEMPERANCE_BACKUP_DIR" || { echo "FAIL - skill-install block missing TEMPERANCE_BACKUP_DIR backup"; fail=1; }
echo "$block" | grep -q '\$SKILL_DST\.bak' && { echo "FAIL - skill-install block backs up to a sibling inside the scanned skills dir"; fail=1; } || echo "ok - backup does not live inside the scanned skills dir"
# destination is cleared before the fresh copy, so cp -R can't nest SRC inside
# a pre-existing DST on repeat installs
echo "$block" | grep -q 'rm -rf "\$SKILL_DST"' && echo "ok - skill-install block clears destination before reinstall (no nesting)" || { echo "FAIL - skill-install block does not clear destination before reinstall"; fail=1; }
# skill-install block emits a printf/echo log line naming the backup path, distinct
# from the existing "skill -> $SKILL_DST" install log line
backup_log=$(echo "$block" | grep -E '(printf|echo).*(backed up|BAK)')
[[ -n "$backup_log" ]] && echo "ok - skill-install block logs backup path" || { echo "FAIL - skill-install block does not log backup path"; fail=1; }
exit $fail
