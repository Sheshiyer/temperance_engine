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
# skill-install block backs up an existing dest to a .bak path before overwriting
block=$(awk '/Install temperance-parallel-dispatch skill/,/^fi$/' "$DIR/install.sh")
echo "$block" | grep -q '\.bak\.' && echo "ok - skill-install block makes a .bak backup" || { echo "FAIL - skill-install block missing .bak copy"; fail=1; }
# skill-install block emits a printf/echo log line naming the backup path, distinct
# from the existing "skill -> $SKILL_DST" install log line
backup_log=$(echo "$block" | grep -E '(printf|echo).*(backed up|BAK)')
[[ -n "$backup_log" ]] && echo "ok - skill-install block logs backup path" || { echo "FAIL - skill-install block does not log backup path"; fail=1; }
exit $fail
