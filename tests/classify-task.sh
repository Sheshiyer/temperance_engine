#!/usr/bin/env bash
# tests/classify-task.sh — unit tests for the shared POSIX-sh classifier.
# Exercises it under BOTH /bin/sh and homebrew bash to prove portability.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CT="$DIR/package/router/classify-task.sh"
fail=0
ck(){ if [[ "$2" == "$3" ]]; then echo "ok   - $1"; else echo "FAIL - $1: exp[$2] got[$3]"; fail=1; fi; }

# CLI output = "<type>\t<model>" ; helper returns just the type
type_of(){ "$1" "$CT" "$2" | cut -f1; }
model_of(){ "$1" "$CT" "$2" | cut -f2; }

for SH in /bin/sh /opt/homebrew/bin/bash; do
  [[ -x "$SH" ]] || { echo "skip - $SH not present"; continue; }
  ck "[$SH] long-horizon (refactor)"      "long-horizon" "$(type_of "$SH" 'refactor the auth module')"
  ck "[$SH] quick refactor -> long-horizon" "long-horizon" "$(type_of "$SH" 'quick refactor the module')"
  ck "[$SH] analyze+refactor -> long-horizon" "long-horizon" "$(type_of "$SH" 'analyze and refactor the code')"
  ck "[$SH] reasoning (debug)"            "reasoning"    "$(type_of "$SH" 'debug this failure')"
  ck "[$SH] validation (audit)"          "validation"   "$(type_of "$SH" 'audit the code')"
  ck "[$SH] creative (brainstorm)"       "creative"     "$(type_of "$SH" 'brainstorm ideas')"
  ck "[$SH] fast (fix typo)"             "fast"         "$(type_of "$SH" 'fix typo in header')"
  ck "[$SH] inline (summarize, no tool)" "inline"       "$(type_of "$SH" 'summarize this text')"
  ck "[$SH] inline guard (summarize+edit)" "balanced"   "$(type_of "$SH" 'summarize then edit the file')"
  ck "[$SH] default balanced"            "balanced"     "$(type_of "$SH" 'do the thing')"
  ck "[$SH] empty -> balanced"           "balanced"     "$(type_of "$SH" '')"
  ck "[$SH] model(long-horizon)" "command-code:moonshotai/Kimi-K2.7-Code" "$(model_of "$SH" 'refactor the auth module')"
  ck "[$SH] model(inline)"       "inline:current-session"                 "$(model_of "$SH" 'summarize this text')"
done

echo "=== classify-task: $([[ $fail -eq 0 ]] && echo PASS || echo FAIL) ==="
exit $fail
