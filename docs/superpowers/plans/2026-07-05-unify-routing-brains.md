# Unify the Three Routing Brains — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three drifting task-routing brains into one authoritative router — a shared POSIX-sh classifier that `multi-backend-router.sh` sources and `routing.ts` execs — with a `--verdict` layer emitting `inline` / `external(backend,model)` / `claude-subagent`.

**Architecture:** Extract the task-type classifier + the command-code type→model primary into a single POSIX-sh unit `package/router/classify-task.sh`. `multi-backend-router.sh` (MBR) sources it: its `analyze_task_type` delegates to the shared `classify_task_type`, and `ROUTING_PRIORITY`'s command-code column is *derived* from the shared `model_for_type` (grok/kimi fallback tails stay MBR-local literals). MBR gains a `--verdict` mode that is a pure remap of `route_only`. `routing.ts` deletes its own classifier + preferred-model table and execs `classify-task.sh` instead. `route-task.sh` is deleted. All existing output contracts stay byte-identical.

**Tech Stack:** POSIX sh (classify-task.sh), bash 5.x (MBR), TypeScript/bun (routing.ts + its test), jq, grep -E.

## Global Constraints

- `classify-task.sh` is **POSIX sh** (`#!/usr/bin/env sh`), no bashisms — it must run under `/bin/sh`, macOS system bash 3.2, and homebrew bash 5.x. It must NOT call `set -e`/`set -u`/`set -o pipefail` (it is sourced into MBR and must not mutate MBR's shell options).
- No Node/`bun` dependency in any bash path. `routing.ts` may exec `classify-task.sh` (a shell script), but the bash dispatch path must never require Node.
- JSON only via `jq` (never string-interpolated). No absolute user-home or machine-specific paths — use `$HOME`/env/`SCRIPT_DIR`.
- **command-code is the sole auto-preferred external backend.** grok/kimi remain reachable only via MBR's `--backend` and the dispatch fallback chain; never auto-preferred. `nvidia` never appears in `--route-only-with-fallbacks`.
- `claude-subagent` = the no-external-backend fallback (reinterprets MBR's `none` sentinel). No new positive "needs-session" classifier.
- **Preserve byte-for-byte:** `--route-only` (C1), `--route-only-with-fallbacks` incl. nvidia-absent (C2), `--list-backends` (C3), the `routing:` line + trailing `| skill=temperance-parallel-dispatch` + empty zero-backend branch (C6). `--json` may only gain an additive `.verdict` key.
- Additive-first ordering: land classify-task.sh + `--verdict` (Tasks 1–3) before deleting `route-task.sh` / rewiring `routing.ts` (Tasks 4–5), so every task is independently green.
- Fail-open everywhere; `classify-task.sh` never errors on odd input.
- Run bash tests with homebrew bash: `/opt/homebrew/bin/bash tests/<name>.sh`. Run TS test with `bun test package/enrich/stages/routing.test.ts`. Full gate: the 8 `tests/*.sh` suites + `verify.sh` + the bun test.

---

### Task 1: `classify-task.sh` — shared POSIX-sh classifier

**Files:**
- Create: `package/router/classify-task.sh`
- Test: `tests/classify-task.sh`

**Interfaces:**
- Produces (sourceable functions): `classify_task_type "<task>"` → echoes one of `long-horizon|reasoning|validation|creative|fast|inline|balanced`; `model_for_type "<type>"` → echoes `<backend>:<model>`.
- Produces (CLI): `classify-task.sh "<task>"` → one line `<type>\t<backend>:<model>`, exit 0.
- The regexes and the type→model map are copied **verbatim** from MBR's current `analyze_task_type` (`multi-backend-router.sh:138-183`) and `ROUTING_PRIORITY` first-tokens (`:114-132`), so behaviour is identical.

- [ ] **Step 1: Write the failing test** — `tests/classify-task.sh`

```bash
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `/opt/homebrew/bin/bash tests/classify-task.sh`
Expected: FAIL — `classify-task.sh` does not exist yet (every check errors/empty).

- [ ] **Step 3: Create `package/router/classify-task.sh`**

```sh
#!/usr/bin/env sh
# package/router/classify-task.sh
# Single source of truth for task-type classification + the command-code
# primary model per type. POSIX sh (no bashisms) so it runs under /bin/sh,
# macOS system bash, and homebrew bash alike. Sourced by
# multi-backend-router.sh (functions only) and exec'd by
# package/enrich/stages/routing.ts (CLI). Pure: NO backend detection, NO
# availability gating -- that stays in the router. Does NOT call `set` (it is
# sourced into a script with its own shell options and must not mutate them).

# classify_task_type "<task>" -> one of:
#   long-horizon | reasoning | validation | creative | fast | inline | balanced
# Ordered, first-match-wins. This is the ONLY copy of these regexes.
classify_task_type() {
  lower_desc=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  if printf '%s' "$lower_desc" | grep -qE '\b(refactor|rewrite|migrate|redesign|overhaul|restructure|entire|all files|across.*files)\b'; then
    echo "long-horizon"; return
  fi
  if printf '%s' "$lower_desc" | grep -qE '\b(analyze|debug|diagnose|explain|understand|reason|think|complex|difficult)\b'; then
    echo "reasoning"; return
  fi
  if printf '%s' "$lower_desc" | grep -qE '\b(validate|verify|review|check|audit|test|ensure|confirm)\b'; then
    echo "validation"; return
  fi
  if printf '%s' "$lower_desc" | grep -qE '\b(brainstorm|creative|design|explore|imagine|ideate|alternative)\b'; then
    echo "creative"; return
  fi
  if printf '%s' "$lower_desc" | grep -qE '\b(quick|simple|small|minor|tweak|fix typo|update comment)\b'; then
    echo "fast"; return
  fi
  if printf '%s' "$lower_desc" | grep -qE '\b(extract|classify|summarize|list|identify|find|count)\b'; then
    if ! printf '%s' "$lower_desc" | grep -qE '\b(read|search|grep|edit|write|run|execute|test|build|compile)\b'; then
      echo "inline"; return
    fi
  fi
  echo "balanced"
}

# model_for_type "<type>" -> "<backend>:<model>" (the command-code primary;
# inline -> current-session sentinel). Single source of the type->primary
# catalog: MBR derives ROUTING_PRIORITY's command-code column from this, and
# routing.ts renders `preferred=` from it.
model_for_type() {
  case "$1" in
    fast)         echo "command-code:deepseek/deepseek-v4-flash" ;;
    long-horizon) echo "command-code:moonshotai/Kimi-K2.7-Code" ;;
    reasoning)    echo "command-code:claude-fable-5" ;;
    validation)   echo "command-code:google/gemini-3.5-flash" ;;
    creative)     echo "command-code:claude-sonnet-5" ;;
    inline)       echo "inline:current-session" ;;
    *)            echo "command-code:claude-sonnet-5" ;;
  esac
}

# CLI: `classify-task.sh "<task>"` -> "<type>\t<backend>:<model>". Runs ONLY
# when executed directly, not when sourced. The basename-of-$0 guard works in
# both bash (sourcing does not change $0) and sh.
_classify_main() {
  _t=$(classify_task_type "$1")
  printf '%s\t%s\n' "$_t" "$(model_for_type "$_t")"
}
case "${0##*/}" in
  classify-task.sh) _classify_main "$@" ;;
esac
```

- [ ] **Step 4: Make it executable**

Run: `chmod +x package/router/classify-task.sh`

- [ ] **Step 5: Run test to verify it passes**

Run: `/opt/homebrew/bin/bash tests/classify-task.sh`
Expected: PASS — `=== classify-task: PASS ===`, exit 0. (Confirms both `/bin/sh` and homebrew-bash rows pass, incl. `quick refactor → long-horizon`.)

- [ ] **Step 6: Commit**

```bash
chmod +x tests/classify-task.sh
git add package/router/classify-task.sh tests/classify-task.sh
git commit -m "feat(router): shared POSIX-sh classify-task.sh (single classifier + type->model source) (#6)"
```

---

### Task 2: MBR sources the shared classifier; delegate classification + derive `ROUTING_PRIORITY`

**Files:**
- Modify: `package/router/multi-backend-router.sh` (add source after `SCRIPT_DIR` `:34`; replace `analyze_task_type` body `:138-183`; replace literal `ROUTING_PRIORITY` `:114-132` with a derived build)
- Test: `tests/router-hardening.sh` (add a golden-equivalence block + a parity block)

**Interfaces:**
- Consumes from Task 1: `classify_task_type`, `model_for_type` (sourced).
- Produces: unchanged public behaviour of `select_route`, `route_only`, `route_only_with_fallbacks`, `--json`, `--list-backends` — the refactor is internal.

- [ ] **Step 1: Write the failing test** — append to `tests/router-hardening.sh` (before its final `exit`)

```bash
# --- #6 unification: classifier is now sourced from classify-task.sh ---
# Parity: MBR's task classification must equal the shared classifier's for a corpus.
R="$DIR/package/router/multi-backend-router.sh"
CT="$DIR/package/router/classify-task.sh"
for t in "refactor the auth module" "quick refactor the module" "debug this" \
         "audit the code" "brainstorm ideas" "fix typo" "summarize this text" "do the thing"; do
  via_ct="$("$CT" "$t" | cut -f1)"
  # MBR --json exposes .task_type; use it as MBR's classification of record.
  via_mbr="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --json "$t" | jq -r '.task_type')"
  if [[ "$via_ct" == "$via_mbr" ]]; then echo "ok   - parity[$t]=$via_ct"; else echo "FAIL - parity[$t]: ct=$via_ct mbr=$via_mbr"; fail=1; fi
done
# quick refactor must classify as long-horizon in MBR too (proves shared ordering)
qr="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --json 'quick refactor the module' | jq -r '.task_type')"
if [[ "$qr" == "long-horizon" ]]; then echo "ok   - MBR quick-refactor=long-horizon"; else echo "FAIL - MBR quick-refactor=$qr"; fail=1; fi
```

> Note: `tests/router-hardening.sh` already defines `DIR`, `fail`, and uses `bash "$R"`. Match its existing helper style; if it uses a `check`/`ck` helper, route these through it instead of inline `if`.

- [ ] **Step 2: Run to verify it fails**

Run: `/opt/homebrew/bin/bash tests/router-hardening.sh`
Expected: FAIL — the parity block errors because MBR does not yet source `classify-task.sh` (and the `quick refactor` assertion still passes coincidentally today, but the parity harness is new). Confirm the suite reports the new lines and a non-zero exit only if a parity mismatch exists; if all pass pre-change, proceed — the real RED is Step 4's refactor must keep them green.

- [ ] **Step 3: Source the shared classifier in MBR**

In `package/router/multi-backend-router.sh`, immediately after line 34 (`SCRIPT_DIR=...`), add:

```bash
# Single source of task-type classification + command-code type->model primary
# (issue #6). classify-task.sh is POSIX sh and only defines functions when
# sourced (its CLI dispatch is guarded by $0), so this does not run anything.
# shellcheck source=classify-task.sh
. "$SCRIPT_DIR/classify-task.sh"
```

- [ ] **Step 4: Delegate `analyze_task_type` to the shared classifier**

Replace the entire body of `analyze_task_type()` (`:138-183`) with a one-line delegation (keep the function name — `select_route`/`route_only`/`main` all call it):

```bash
analyze_task_type() {
  classify_task_type "$1"
}
```

- [ ] **Step 5: Derive `ROUTING_PRIORITY`'s command-code column from `model_for_type`**

Replace the literal `declare -A ROUTING_PRIORITY=( ... )` block (`:114-132`) with a derived build. The grok/kimi fallback tails stay MBR-local literals (they are never auto-preferred and never touched by routing.ts):

```bash
# grok/kimi fallback tails per task type (command-code primary is derived from
# classify-task.sh's model_for_type, so the type->model catalog has ONE source).
declare -A ROUTING_FALLBACK_TAILS=(
  ["fast"]="grok:grok-composer-2.5-fast kimi:kimi-code/kimi-for-coding"
  ["long-horizon"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
  ["reasoning"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
  ["validation"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
  ["creative"]="grok:grok-composer-2.5-fast kimi:kimi-code/kimi-for-coding"
  ["balanced"]="grok:grok-build kimi:kimi-code/kimi-for-coding"
)
declare -A ROUTING_PRIORITY=()
for _rt in fast long-horizon reasoning validation creative balanced; do
  ROUTING_PRIORITY["$_rt"]="$(model_for_type "$_rt") ${ROUTING_FALLBACK_TAILS[$_rt]}"
done
unset _rt
```

This yields byte-identical `ROUTING_PRIORITY` values to the previous literals (e.g. `fast` = `command-code:deepseek/deepseek-v4-flash grok:grok-composer-2.5-fast kimi:kimi-code/kimi-for-coding`), so `select_route`/`route_only`/`route_only_with_fallbacks` are untouched and C1/C2 are preserved by construction.

- [ ] **Step 6: Run tests to verify they pass**

Run: `/opt/homebrew/bin/bash tests/router-hardening.sh`
Expected: PASS — all pre-existing C1/C2/C3 assertions unchanged AND the new parity block green (`parity[...]` all ok, `MBR quick-refactor=long-horizon` ok).

- [ ] **Step 7: Commit**

```bash
git add package/router/multi-backend-router.sh tests/router-hardening.sh
git commit -m "refactor(router): MBR sources classify-task.sh; derive ROUTING_PRIORITY primary from it (#6)"
```

---

### Task 3: MBR `--verdict` mode (+ additive `.verdict` in `--json`)

**Files:**
- Modify: `package/router/multi-backend-router.sh` (add `verdict()` near `route_only` `:264`; add `--verdict` to `main()` arg loop `:497` + dispatch `:533`; add the usage line `:457`; add `verdict` to `output_json` `:415-418` and to the inline-json branch `:550`)
- Test: `tests/router-hardening.sh` (add a `--verdict` block)

**Interfaces:**
- Consumes: `route_only` (existing), which returns `inline\t-` | `none\t-` | `backend\tmodel`.
- Produces: `multi-backend-router.sh --verdict "<task>"` → one line: `inline` | `external\t<backend>\t<model>` | `claude-subagent`, exit 0. `--json` output gains `.verdict`.

- [ ] **Step 1: Write the failing test** — append to `tests/router-hardening.sh`

```bash
# --- #6 unification: --verdict mode + verdict<->route-only agreement ---
R="$DIR/package/router/multi-backend-router.sh"
# inline task -> inline
v="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --verdict 'summarize this text')"
[[ "$v" == "inline" ]] && echo "ok   - verdict inline" || { echo "FAIL - verdict inline: $v"; fail=1; }
# non-trivial + backend available -> external<TAB>command-code<TAB>model
# (route_only emits the model WITHOUT its "command-code:" prefix, so verdict
#  carries the bare model in field 3.)
v="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --verdict 'refactor the auth module')"
[[ "$v" == "external"$'\t'"command-code"$'\t'"moonshotai/Kimi-K2.7-Code" ]] \
  && echo "ok   - verdict external" || { echo "FAIL - verdict external: $v"; fail=1; }
# non-trivial + NO backend -> claude-subagent
v="$(TEMPERANCE_BACKENDS='' bash "$R" --verdict 'refactor the auth module')"
[[ "$v" == "claude-subagent" ]] && echo "ok   - verdict claude-subagent" || { echo "FAIL - verdict subagent: $v"; fail=1; }
# verdict <-> route-only agreement for a corpus
for t in "summarize this text" "refactor the auth module" "audit the code"; do
  ro="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --route-only "$t")"
  vv="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --verdict "$t")"
  case "$ro" in
    inline$'\t'-) exp="inline" ;;
    none$'\t'-)   exp="claude-subagent" ;;
    *)            exp="external"$'\t'"${ro%%$'\t'*}"$'\t'"${ro#*$'\t'}" ;;
  esac
  [[ "$vv" == "$exp" ]] && echo "ok   - agree[$t]" || { echo "FAIL - agree[$t]: ro=$ro v=$vv"; fail=1; }
done
# --json carries an additive .verdict
jv="$(TEMPERANCE_BACKENDS='command-code' bash "$R" --json 'refactor the auth module' | jq -r '.verdict')"
[[ "$jv" == "external" ]] && echo "ok   - json.verdict" || { echo "FAIL - json.verdict: $jv"; fail=1; }
```

- [ ] **Step 2: Run to verify it fails**

Run: `/opt/homebrew/bin/bash tests/router-hardening.sh`
Expected: FAIL — `--verdict` is an unknown flag (falls through to `desc`), and `.verdict` is absent from `--json`.

- [ ] **Step 3: Add the `verdict()` function**

In `package/router/multi-backend-router.sh`, immediately after `route_only()` (after line 264), add:

```bash
# verdict: the unified 3-verdict classification (issue #6). Pure remap of
# route_only so --verdict and --route-only can never disagree.
#   inline\t-      -> inline
#   none\t-        -> claude-subagent   (no external backend => needs live session)
#   backend\tmodel -> external\tbackend\tmodel
verdict() {
  local line b m
  line=$(route_only "$1")
  b=${line%%$'\t'*}; m=${line#*$'\t'}
  case "$b" in
    inline) printf 'inline\n' ;;
    none)   printf 'claude-subagent\n' ;;
    *)      printf 'external\t%s\t%s\n' "$b" "$m" ;;
  esac
}

# verdict_label: just the first field of verdict() (inline|external|claude-subagent),
# for embedding in --json.
verdict_label() {
  verdict "$1" | cut -f1
}
```

- [ ] **Step 4: Wire `--verdict` into `main()`**

In the `main()` arg loop, add after the `--route-only-with-fallbacks` case (`:498`):

```bash
      --verdict) verdict_mode=true; shift ;;
```

Declare the flag with the other mode flags (after `:487`):

```bash
  local verdict_mode=false
```

Add the dispatch after the `route_only_fallbacks_mode` block (after `:541`):

```bash
  if $verdict_mode; then
    verdict "$desc"
    exit 0
  fi
```

Add the usage line after `:461` (in the `usage()` heredoc):

```
  --verdict           Print the unified verdict: "inline" |
                      "external<TAB>backend<TAB>model" | "claude-subagent"
```

- [ ] **Step 5: Add additive `.verdict` to `--json`**

In `output_json()` (`:415-418`), add a `verdict` arg and field:

```bash
  jq -n --arg task "$desc" --arg tt "$task_type" --arg b "$backend" --arg m "$model" \
        --arg tier "$tier" --arg s "$strength" --arg c "$context" --arg avail "$(detect_backends)" \
        --arg verdict "$(verdict_label "$desc")" \
    '{task:$task, task_type:$tt, backend:$b, model:$m, tier:$tier, strength:$s,
      context_window:$c, available_backends:$avail, verdict:$verdict}'
```

And in the inline-task JSON branch (`:550`), replace the hardcoded object so it also carries `verdict`:

```bash
      echo '{"task_type": "inline", "executor": "inline", "verdict": "inline", "reason": "one-shot extraction, no external dispatch"}'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `/opt/homebrew/bin/bash tests/router-hardening.sh`
Expected: PASS — verdict inline/external/claude-subagent, all `agree[...]`, and `json.verdict` green; every pre-existing assertion still green.

- [ ] **Step 7: Commit**

```bash
git add package/router/multi-backend-router.sh tests/router-hardening.sh
git commit -m "feat(router): --verdict mode (inline/external/claude-subagent) as a pure route_only remap (#6)"
```

---

### Task 4: `routing.ts` defers to the shared classifier

**Files:**
- Modify: `package/enrich/stages/routing.ts` (delete `classifyTaskType` `:42-55` and `getPreferred` `:60-72`; add a `classifyViaShared` exec; keep `detectBackends`)
- Test: `package/enrich/stages/routing.test.ts` (keep the 3 existing tests green; add a shared-classifier assertion)

**Interfaces:**
- Consumes: `classify-task.sh` CLI at `package/router/classify-task.sh` (resolved as `../../router/classify-task.sh` from `package/enrich/stages/`).
- Produces: the SAME `routing:` line shape (C6). Only the source of `task`/`preferred` changes.

- [ ] **Step 1: Write the failing test** — append inside the `describe('routing stage', ...)` block in `routing.test.ts`

```typescript
  it('uses the shared classifier ordering: "quick refactor" -> long-horizon (forced backend via shim)', () => {
    // routing.ts must defer to classify-task.sh, whose MBR-ordering classifies
    // "quick refactor" as long-horizon (its OLD local classifier said "fast").
    const shimDir = '/tmp/temperance-routing-test-shim-bin';
    execFileSync('mkdir', ['-p', shimDir]);
    execFileSync('bash', [
      '-c',
      `printf '#!/bin/sh\\nexit 0\\n' > ${shimDir}/command-code && chmod +x ${shimDir}/command-code`,
    ]);
    const r = runRoutingWithEnv('quick refactor the module', `${shimDir}:/usr/bin:/bin`);
    expect(r.line).toContain('| task=long-horizon');
    expect(r.line).toContain('preferred=command-code:moonshotai/Kimi-K2.7-Code');
    expect(r.line.endsWith('| skill=temperance-parallel-dispatch')).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test package/enrich/stages/routing.test.ts`
Expected: FAIL — current `classifyTaskType` returns `fast` for "quick refactor" (fast-first order), so `task=fast` ≠ `task=long-horizon`.

- [ ] **Step 3: Rewrite `routing.ts` internals**

Replace the imports block and the `classifyTaskType`/`getPreferred` functions. New top-of-file imports (add `dirname`, `fileURLToPath`, `execFileSync`; keep the rest):

```typescript
import type { Stage } from '../contract';
import { execSync, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLASSIFY_SH = join(__dirname, '..', '..', 'router', 'classify-task.sh');
```

Keep `detectBackends()` exactly as-is (`:14-40`) and `SKILL_POINTER` (`:58`). DELETE `classifyTaskType` (`:42-55`) and `getPreferred` (`:60-72`), and add:

```typescript
/** Defer task-type + preferred model to the single source of truth
 *  (package/router/classify-task.sh). Fail-open to balanced on any error. */
function classifyViaShared(prompt: string): { taskType: string; preferred: string } {
  try {
    const out = execFileSync(CLASSIFY_SH, [prompt], { encoding: 'utf8' }).trim();
    const [taskType, preferred] = out.split('\t');
    if (taskType && preferred) return { taskType, preferred };
  } catch {
    /* fall through to fail-open default */
  }
  return { taskType: 'balanced', preferred: 'command-code:claude-sonnet-5' };
}
```

Update the stage body (`:74-92`) to use it:

```typescript
export const routing: Stage = (ctx) => {
  try {
    const backends = detectBackends();
    if (backends.length === 0) {
      return { line: '', degraded: false }; // No external backends available
    }
    const prompt = ctx.input?.prompt || '';
    const { taskType, preferred } = classifyViaShared(prompt);
    return {
      line: `routing: backends=${backends.join(',')} | task=${taskType} | preferred=${preferred} | skill=${SKILL_POINTER}`,
      degraded: false,
    };
  } catch {
    return { line: '', degraded: true };
  }
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/enrich/stages/routing.test.ts`
Expected: PASS — all 4 tests green (the 3 original C6 assertions + the new `quick refactor → long-horizon`).

- [ ] **Step 5: Commit**

```bash
git add package/enrich/stages/routing.ts package/enrich/stages/routing.test.ts
git commit -m "refactor(enrich): routing.ts defers to classify-task.sh; drop local classifier + preferred table (#6)"
```

---

### Task 5: Retire `route-task.sh`

**Files:**
- Delete: `package/router/route-task.sh`
- Modify: any file referencing it (grep-driven — expected: docs, possibly `scripts/wire-*.sh`, ISA)
- Test: `tests/router-hardening.sh` (add a no-dangling-reference guard)

**Interfaces:** none produced; this removes a zero-consumer file.

- [ ] **Step 1: Inventory references**

Run: `grep -rn --exclude-dir=.git --exclude-dir=node_modules 'route-task\.sh' . || echo "no references"`
Record every hit. Expected: the file itself, plus possibly doc mentions. There must be **no** executable consumer (the brainstorm's repo-wide grep found none).

- [ ] **Step 2: Write the failing guard** — append to `tests/router-hardening.sh`

```bash
# --- #6: route-task.sh is retired; nothing may reference it ---
refs="$(grep -rln --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=docs 'route-task\.sh' "$DIR" || true)"
if [[ -z "$refs" ]]; then echo "ok   - no route-task.sh references (code)"; else echo "FAIL - route-task.sh still referenced: $refs"; fail=1; fi
if [[ -e "$DIR/package/router/route-task.sh" ]]; then echo "FAIL - route-task.sh still exists"; fail=1; else echo "ok   - route-task.sh deleted"; fi
```

(The `--exclude-dir=docs` keeps historical spec/plan prose from tripping the *code* guard; Step 4 still updates any live doc that describes current behaviour.)

- [ ] **Step 3: Run to verify it fails**

Run: `/opt/homebrew/bin/bash tests/router-hardening.sh`
Expected: FAIL — `route-task.sh still exists`.

- [ ] **Step 4: Delete the file and clean references**

```bash
git rm package/router/route-task.sh
```

For each non-docs reference found in Step 1 (e.g. a `scripts/wire-*.sh` symlink line, an ISA mention of the "three brains"), edit it to drop `route-task.sh`. For live docs that describe the *current* architecture (e.g. `docs/pai-flow.md`), update the prose to say the router is unified (leave dated specs/plans as historical record). If Step 1 found only the file itself + dated specs/plans, no edits beyond the deletion are needed.

- [ ] **Step 5: Run tests to verify they pass**

Run: `/opt/homebrew/bin/bash tests/router-hardening.sh`
Expected: PASS — `no route-task.sh references (code)` + `route-task.sh deleted`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(router): retire route-task.sh (zero consumers; superseded by unified router) (#6)"
```

---

### Task 6: ISA + docs record the unified router

**Files:**
- Modify: `ISA.md` (append new ISC entries; annotate any three-brains ISC as superseded)
- Modify: `docs/pai-flow.md` (or whichever live doc describes routing) if not already handled in Task 5
- Test: `tests/docs-continuity.sh` (append a grep assertion for the unified-router invariant)

**Interfaces:** none produced; documentation + ISA.

- [ ] **Step 1: Find the current max ISC number**

Run: `grep -oE 'ISC-[0-9]+' ISA.md | sort -t- -k2 -n | tail -1`
Record it; new entries start at max+1 (do NOT assume — the running max has grown across prior work).

- [ ] **Step 2: Write the failing doc assertion** — append to `tests/docs-continuity.sh`

```bash
# --- #6: unified router invariant is documented ---
grep -q 'classify-task\.sh' ISA.md || { echo "FAIL - ISA missing classify-task.sh invariant"; fail=1; }
grep -q -- '--verdict' ISA.md || { echo "FAIL - ISA missing --verdict"; fail=1; }
```

(Match `tests/docs-continuity.sh`'s existing helper/`fail` convention; if it uses a `check` function, use it.)

- [ ] **Step 3: Run to verify it fails**

Run: `/opt/homebrew/bin/bash tests/docs-continuity.sh`
Expected: FAIL — ISA does not yet mention `classify-task.sh` / `--verdict`.

- [ ] **Step 4: Add ISA entries**

Append to `ISA.md` (using max+1, max+2 from Step 1 — shown here as `ISC-N`/`ISC-N+1`, substitute the real numbers):

```markdown
- **ISC-N — Unified task router (single classifier).** Task-type classification and the command-code type→model primary live in exactly one place: `package/router/classify-task.sh` (POSIX sh). `multi-backend-router.sh` sources it (its `analyze_task_type` delegates; `ROUTING_PRIORITY`'s command-code column is derived from `model_for_type`), and `package/enrich/stages/routing.ts` execs it. No routing surface re-implements the classifier. `route-task.sh` is retired.
- **ISC-N+1 — Three routing verdicts.** `multi-backend-router.sh --verdict "<task>"` emits exactly one of `inline` | `external<TAB>backend<TAB>model` | `claude-subagent`, as a pure remap of `--route-only` (so they never disagree). `external` is always `command-code:<model>` (grok/kimi reachable only via `--backend`/fallback chain); `claude-subagent` is the no-external-backend case.
```

If an existing ISC describes the pre-unification "three brains", append `_(Superseded by ISC-N/ISC-N+1.)_` to it (do not delete).

- [ ] **Step 5: Run tests to verify they pass**

Run: `/opt/homebrew/bin/bash tests/docs-continuity.sh`
Expected: PASS.

- [ ] **Step 6: Full-suite verification**

```bash
for t in classify-task router-hardening dispatch-tasklist skill-install wire-batch docs-continuity readme-continuity-guard identity-tool sandbox-install; do
  /opt/homebrew/bin/bash "tests/$t.sh" >/tmp/u.$t.log 2>&1 && echo "ok $t" || { echo "FAIL $t"; tail -8 /tmp/u.$t.log; }
done
/opt/homebrew/bin/bash verify.sh && echo "ok verify.sh"
bun test package/enrich/stages/routing.test.ts
```
Expected: every suite + `verify.sh` + the bun test green.

- [ ] **Step 7: Commit**

```bash
git add ISA.md docs/ tests/docs-continuity.sh
git commit -m "docs(isa): record unified router invariants (single classifier + three verdicts) (#6)"
```

---

## Verification checklist (spec §12 gap register)

1. `--route-only` / `--route-only-with-fallbacks` / `--list-backends` / `--json` byte-identical for the existing corpus; nvidia absent from fallbacks — **Task 2** (golden C1/C2/C3 stay green).
2. `routing.test.ts` passes incl. the fake-`command-code`-shim case (classifier runs under `/bin/sh`) — **Task 4**.
3. `"quick refactor" → long-horizon` everywhere — **Task 1** (classify-task test), **Task 2** (MBR), **Task 4** (routing.ts).
4. `routing.ts` no longer has an independent classifier or type→model table — **Task 4** (functions deleted).
5. `route-task.sh` gone and unreferenced — **Task 5** (guard test).
6. `--verdict` and `--route-only` agree for the corpus — **Task 3** (agreement block).
7. Full suite + `verify.sh` green on homebrew bash; `classify-task.sh` green under `/bin/sh` — **Task 6 Step 6** + **Task 1**.
