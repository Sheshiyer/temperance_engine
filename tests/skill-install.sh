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
exit $fail
