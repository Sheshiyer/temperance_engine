# Unify Orchestrators (A+F) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document one authoritative flow — PAI 7-phase shell, gsd-core recommended backbone, superpowers + temperance-parallel-dispatch as tools, skill-cluster resolver as the discovery layer — and retire the dead/duplicative orchestrator surfaces.

**Architecture:** Documentation + additive ISCs, near-zero runtime code. `docs/pai-flow.md` becomes the single source of truth; the 4 architecture HTML docs are regenerated views; 2 markdown docs retire to redirect stubs; `package/conductor/routed-execute.sh` is deleted. Every doc change is guarded by a grep assertion in `tests/docs-continuity.sh` (doc-TDD: write the failing assertion first, then the content).

**Tech Stack:** Bash 5.x, POSIX `sh` (install scripts), markdown, HTML (regenerated via the `architecture-diagram-creator` skill), `jq` (unaffected).

**Spec:** `docs/superpowers/specs/2026-07-05-unify-orchestrators-A-F-design.md` — the verbatim source for the architecture diagram (§5), per-phase table (§6), doctrine (§6), realignment deltas (§8), and ISC text (§10). Task implementers read the spec for large verbatim blocks rather than having them duplicated here.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Paths generalized through `$HOME` / env vars** — no hard-coded usernames anywhere.
- **GSD stays recommended-not-required** — `--with-gsd` remains detect-only; ISC-31 preserved; NO ISA amendment of the reference-not-vendor principle. Purely additive ISCs.
- **gsd-core realignment target**: `open-gsd/gsd-core`, URL `https://github.com/open-gsd/gsd-core`, install `npx @opengsd/gsd-core@latest`, phase model Discuss→Plan→Execute→Verify→Ship.
- **Command syntax canonical form**: `/gsd-*` (hyphen). Compat note: Gemini `/gsd:*`, Codex `$gsd-*`.
- **Redirect stubs, not deletions** for `parallel-dispatch.md` + `multi-surface-architecture.md` — `verify-install.sh:22` does `check_file docs/parallel-dispatch.md`; the file must remain present.
- **`verify.sh` must stay green** after every task.
- **Doc-TDD** — each doc task appends its grep assertion(s) to `tests/docs-continuity.sh` FIRST (RED), then writes the content (GREEN).
- **All tests run offline.** Run with `bash tests/<name>.sh` (homebrew bash 5.x — now default per the `.zshenv` fix; no PATH override needed).
- **Bash target 5.x** for tests; install scripts stay POSIX `sh` (`#!/usr/bin/env sh`) matching the existing `install-gsd.sh`.

---

## Task 1: `docs/pai-flow.md` — canonical single source of truth

**Files:**
- Modify (full rewrite): `docs/pai-flow.md`
- Modify (append assertions): `tests/docs-continuity.sh`
- Read for verbatim content: `docs/superpowers/specs/2026-07-05-unify-orchestrators-A-F-design.md` (§5 diagram, §6 table + doctrine)

**Interfaces:**
- Produces: `docs/pai-flow.md` containing 7 phase-row markers, the string `skill-cluster resolver`, the string `gsd-core`, and the `/gsd-*` command form. Later tasks (2, 6, 7) reference this file as the redirect/regeneration target.

- [ ] **Step 1: Write the failing assertions**

Append to `tests/docs-continuity.sh` (before the final `exit $fail`):
```bash
# --- A+F Task 1: pai-flow.md is the canonical unified flow doc ---
PF="$DIR/docs/pai-flow.md"
for phase in Observe Think Plan Build Execute Verify Learn; do
  grep -q "| .*$phase" "$PF" 2>/dev/null && echo "ok - pai-flow row: $phase" \
    || { echo "FAIL - pai-flow.md missing phase row: $phase"; fail=1; }
done
grep -q "skill-cluster resolver" "$PF" && echo "ok - pai-flow mentions skill-cluster resolver" \
  || { echo "FAIL - pai-flow.md missing 'skill-cluster resolver'"; fail=1; }
grep -q "gsd-core" "$PF" && echo "ok - pai-flow mentions gsd-core" \
  || { echo "FAIL - pai-flow.md missing 'gsd-core'"; fail=1; }
grep -q "/gsd-plan-phase" "$PF" && echo "ok - pai-flow uses /gsd-* hyphen commands" \
  || { echo "FAIL - pai-flow.md missing /gsd-* command form"; fail=1; }
grep -q "temperance-parallel-dispatch" "$PF" && echo "ok - pai-flow mentions temperance-parallel-dispatch" \
  || { echo "FAIL - pai-flow.md missing temperance-parallel-dispatch"; fail=1; }
```

- [ ] **Step 2: Run to verify RED**

Run: `bash tests/docs-continuity.sh`
Expected: FAIL lines for the phase rows / gsd-core / skill-cluster resolver (current `pai-flow.md` is the old 24-line summary with none of these).

- [ ] **Step 3: Rewrite `docs/pai-flow.md`**

Replace the entire file. Assemble it in this section order, taking the verbatim architecture diagram from spec §5 and the verbatim 7-row table + doctrine from spec §6:

```markdown
# PAI Flow

The packaged model is a disciplined work loop with one authoritative structure:
**PAI is the 7-phase outer shell; gsd-core is the recommended workflow backbone;
superpowers skills + temperance-parallel-dispatch are the tool inventory the
backbone invokes; the skill-cluster resolver is the discovery/lazy-load layer.**

## Core Principle

Move from current state to ideal state. The ideal state is decomposed into
criteria. Criteria are verified with tools. Work is complete only when the
criteria pass.

## Architecture

<reproduce the ASCII layer diagram from spec §5 verbatim inside a fenced block>

Only PAI + gsd-core hold the session spine; everything else is a called tool.
Observe/Think are agent-native. The skill-cluster resolver
(`~/.agents/skill-clusters/skill-index.json`) sits between "backbone names a
skill" and "tool runs" — it is the context-economy mechanism (only active-spoke
skills loaded; deferred clusters resolved on demand).

## Phases and the decision framework

The table below is DEFAULTS, not mandates — any phase exits when its done-signal
is met. gsd-core commands are shown in the canonical `/gsd-*` hyphen form.

<reproduce the 7-row per-phase table from spec §6 verbatim>

**Cross-cutting gsd-core commands** (not phase-bound): `/gsd-progress`,
`/gsd-resume-work`, `/gsd-pause-work`, `/gsd-manager`, `/gsd-config`, `/gsd-settings`.

**Command-syntax compat note:** gsd-core commands are `/gsd-*` (hyphen) in
Claude Code / gsd-core docs; Gemini CLI spells them `/gsd:*` (colon); Codex uses
`$gsd-*`. Identical commands, runtime-specific spelling.

## Doctrine

<reproduce the 6 numbered doctrine points from spec §6 verbatim>

## GSD is recommended, not required

gsd-core (`open-gsd/gsd-core`, `npx @opengsd/gsd-core@latest`) is the recommended
default backbone. When gsd-core is present, use its phase commands. When absent,
the superpowers column of the table above IS the flow:
`brainstorming → writing-plans → subagent-driven-development →
verification-before-completion → finishing-a-development-branch`.
`--with-gsd` at install time is detect-only and never vendors gsd-core.

## ISA Pattern

An ISA is the system of record for a task or project. It contains problem,
vision, constraints, goal, criteria, test strategy, features, decisions,
changelog, and verification.

## Completion Rule

No completion claim without fresh verification evidence.

## Retired surfaces (folded into this doc)

- `docs/parallel-dispatch.md` — the Execute-phase dispatch decision is now this
  doc's Execute row + doctrine. `superpowers:dispatching-parallel-agents` remains
  the **Claude-subagent primitive**; `temperance-parallel-dispatch` (external
  backends via `temperance-batch`) builds on it. (Redirect stub retained.)
- `docs/multi-surface-architecture.md` — the enrichment/router/adapter layers are
  this doc's Architecture section. (Redirect stub retained.)
- `package/conductor/routed-execute.sh` — superseded by
  `package/router/dispatch-tasklist.sh` (`temperance-batch`).
```

Reproduce the three "verbatim" blocks by reading them from the spec file — do not paraphrase the table, diagram, or doctrine. The "Retired surfaces" section above MUST contain the exact strings `Claude-subagent primitive`, `temperance-parallel-dispatch`, and `temperance-batch` — Task 2 repoints existing `docs-continuity` assertions onto them.

- [ ] **Step 4: Run to verify GREEN**

Run: `bash tests/docs-continuity.sh`
Expected: all `ok -` lines including the 7 phase rows, skill-cluster resolver, gsd-core, `/gsd-*`, temperance-parallel-dispatch.

- [ ] **Step 5: Verify repo verifier still green**

Run: `bash verify.sh`
Expected: exit 0 (pai-flow.md still present; no private paths introduced).

- [ ] **Step 6: Commit**

```bash
git add docs/pai-flow.md tests/docs-continuity.sh
git commit -m "docs(pai-flow): canonical unified flow — PAI shell, gsd-core backbone, per-phase table"
```

---

## Task 2: Deprecate `parallel-dispatch.md` + `multi-surface-architecture.md` to redirect stubs

**Files:**
- Modify (replace body): `docs/parallel-dispatch.md`
- Modify (replace body): `docs/multi-surface-architecture.md`
- Modify (append assertions): `tests/docs-continuity.sh`

**Interfaces:**
- Consumes: `docs/pai-flow.md` (Task 1) exists as the redirect target.
- Produces: both files reduced to a redirect header containing the string `Retired`.

- [ ] **Step 1: Write the failing assertions**

Append to `tests/docs-continuity.sh`:
```bash
# --- A+F Task 2: retired docs are redirect stubs ---
grep -qi "retired" "$DIR/docs/parallel-dispatch.md" && grep -q "pai-flow.md" "$DIR/docs/parallel-dispatch.md" \
  && echo "ok - parallel-dispatch.md is a redirect stub" \
  || { echo "FAIL - parallel-dispatch.md not a redirect stub"; fail=1; }
grep -qi "retired" "$DIR/docs/multi-surface-architecture.md" && grep -q "pai-flow.md" "$DIR/docs/multi-surface-architecture.md" \
  && echo "ok - multi-surface-architecture.md is a redirect stub" \
  || { echo "FAIL - multi-surface-architecture.md not a redirect stub"; fail=1; }
```

- [ ] **Step 2: Run to verify RED**

Run: `bash tests/docs-continuity.sh`
Expected: FAIL for both — current files are full content, contain "Retired" nowhere.

Note: Task 14 (I3) added the routed-external-rail decision tree to `parallel-dispatch.md`; the prior `docs-continuity` assertions for `temperance-batch` / `temperance-parallel-dispatch` / `Claude-subagent primitive` live there. Move those three grep targets to point at `docs/pai-flow.md` in the SAME edit (pai-flow.md now carries that content), so those assertions keep passing.

- [ ] **Step 3: Replace `docs/parallel-dispatch.md` with a stub**

```markdown
# Parallel Dispatch — retired

This document is **retired**. The Execute-phase dispatch decision (GSD
`execute-phase` vs `superpowers:dispatching-parallel-agents` vs
`temperance-parallel-dispatch` vs sequential) now lives in
[`docs/pai-flow.md`](./pai-flow.md) — see its **Phases and the decision framework**
table (Execute row) and **Doctrine**.

The `temperance-parallel-dispatch` skill (external backends via `temperance-batch`)
builds on `superpowers:dispatching-parallel-agents` (the Claude-subagent primitive).
```

- [ ] **Step 4: Replace `docs/multi-surface-architecture.md` with a stub**

```markdown
# Multi-Surface Orchestration Architecture — retired

This document is **retired**. The enrichment core, surface adapters, task-model
router, and layered architecture are now described in
[`docs/pai-flow.md`](./pai-flow.md) — see its **Architecture** section. The
`package/conductor/routed-execute.sh` prototype it referenced has been removed
(superseded by `package/router/dispatch-tasklist.sh`).
```

- [ ] **Step 5: Update the moved `docs-continuity` targets**

In `tests/docs-continuity.sh`, find the three prior assertions from Task 14 that grepped `docs/parallel-dispatch.md` for `temperance-batch`, `temperance-parallel-dispatch`, and `Claude-subagent primitive`. Repoint each to `$DIR/docs/pai-flow.md`. Task 1's "Retired surfaces" section was written to contain all three exact strings, so the repoint passes without further edits. Verify with:
```bash
for s in "temperance-batch" "temperance-parallel-dispatch" "Claude-subagent primitive"; do
  grep -q "$s" "$DIR/docs/pai-flow.md" || echo "MISSING in pai-flow.md: $s"
done
```
Expected: no `MISSING` lines. (If any appears, Task 1 output is incomplete — add the missing string to pai-flow.md's Retired-surfaces section before repointing.)

- [ ] **Step 6: Run to verify GREEN**

Run: `bash tests/docs-continuity.sh && bash verify.sh`
Expected: both stub assertions ok; the three repointed assertions ok; verify.sh exit 0 (both files still present for `check_file`).

- [ ] **Step 7: Commit**

```bash
git add docs/parallel-dispatch.md docs/multi-surface-architecture.md tests/docs-continuity.sh
git commit -m "docs: retire parallel-dispatch + multi-surface-architecture to redirect stubs"
```

---

## Task 3: Retire `package/conductor/routed-execute.sh`

**Files:**
- Delete: `package/conductor/routed-execute.sh` (and the emptied `package/conductor/` dir)
- Modify (append assertion): `tests/docs-continuity.sh`

**Interfaces:**
- Produces: absence of `package/conductor/routed-execute.sh`.

- [ ] **Step 1: Write the failing assertion**

Append to `tests/docs-continuity.sh`:
```bash
# --- A+F Task 3: conductor retired ---
[ ! -e "$DIR/package/conductor/routed-execute.sh" ] \
  && echo "ok - conductor/routed-execute.sh removed" \
  || { echo "FAIL - package/conductor/routed-execute.sh still present"; fail=1; }
```

- [ ] **Step 2: Run to verify RED**

Run: `bash tests/docs-continuity.sh`
Expected: FAIL — file still present.

- [ ] **Step 3: Confirm zero live consumers, then delete**

```bash
# Confirm nothing wires it (expect no output from install/hooks/symlinks/verify):
grep -rn "routed-execute\|conductor" install.sh scripts/ package/hooks/ 2>/dev/null | grep -v "docs/" || echo "no consumers — safe"
git rm package/conductor/routed-execute.sh
rmdir package/conductor 2>/dev/null || true
```

- [ ] **Step 4: Run to verify GREEN**

Run: `bash tests/docs-continuity.sh && bash verify.sh`
Expected: absence assertion ok; verify.sh exit 0 (`verify-install.sh` does not check conductor).

- [ ] **Step 5: Commit**

```bash
git add -A package/conductor tests/docs-continuity.sh
git commit -m "refactor: retire package/conductor/routed-execute.sh (superseded by dispatch-tasklist.sh)"
```

---

## Task 4: gsd-core realignment — `install-gsd.sh`, `UPSTREAM.md`, `CREDITS.md`

**Files:**
- Modify: `scripts/install-gsd.sh`
- Modify: `UPSTREAM.md`
- Modify: `CREDITS.md`
- Modify (append assertions): `tests/docs-continuity.sh`

**Interfaces:**
- Produces: `UPSTREAM.md` + `CREDITS.md` contain `open-gsd/gsd-core`; `install-gsd.sh` guidance names `npx @opengsd/gsd-core@latest` and detection is permissive (legacy path OR gsd-core marker).

- [ ] **Step 1: Write the failing assertions**

Append to `tests/docs-continuity.sh`:
```bash
# --- A+F Task 4: gsd-core realignment ---
grep -q "open-gsd/gsd-core" "$DIR/UPSTREAM.md" && echo "ok - UPSTREAM credits gsd-core" \
  || { echo "FAIL - UPSTREAM.md missing open-gsd/gsd-core"; fail=1; }
grep -q "open-gsd/gsd-core" "$DIR/CREDITS.md" && echo "ok - CREDITS credits gsd-core" \
  || { echo "FAIL - CREDITS.md missing open-gsd/gsd-core"; fail=1; }
grep -q "@opengsd/gsd-core" "$DIR/scripts/install-gsd.sh" && echo "ok - install-gsd points at gsd-core npx" \
  || { echo "FAIL - install-gsd.sh missing gsd-core npx guidance"; fail=1; }
```

- [ ] **Step 2: Run to verify RED**

Run: `bash tests/docs-continuity.sh`
Expected: FAIL for all three.

- [ ] **Step 3: Edit `scripts/install-gsd.sh`**

Keep it POSIX `sh`, detect-only. Replace the detection + guidance block (current lines 13–21) with a permissive detect (legacy path OR a gsd-core marker) and gsd-core install guidance:
```sh
GSD_HOME="${GSD_HOME:-$HOME/.claude/get-shit-done}"

# gsd-core (open-gsd/gsd-core) installs via npx into the project/global; the
# legacy danielmiessler-lineage path is ~/.claude/get-shit-done. Detect either,
# so back-compat never regresses. Still detect-only — Temperance never vendors GSD.
if test -d "$GSD_HOME" || command -v gsd >/dev/null 2>&1; then
  say "GSD detected (legacy path or gsd-core CLI)."
  say "See docs/pai-flow.md for how gsd-core phases map onto the PAI 7-phase flow."
else
  say "GSD not found. Temperance Engine does not install or vendor GSD."
  say "Recommended: install gsd-core with 'npx @opengsd/gsd-core@latest' (open-gsd/gsd-core)."
  say "See docs/pai-flow.md for the recommended-default flow and its superpowers fallback."
fi
```
(If `command -v gsd` is not gsd-core's actual CLI entrypoint, the legacy `test -d` check still covers detection; the guidance text is the load-bearing change and is correct regardless. Note also line 6 `say "Configuring optional GSD (get-shit-done) reference"` — update the parenthetical to `(gsd-core)`.)

- [ ] **Step 4: Add gsd-core to `UPSTREAM.md`**

In the "Verified GitHub Repositories" table, add a row (keep column alignment with the existing rows):
```markdown
| GSD Core | https://github.com/open-gsd/gsd-core | Recommended workflow backbone (Discuss→Plan→Execute→Verify→Ship); referenced, not vendored. |
```

- [ ] **Step 5: Add gsd-core to `CREDITS.md`**

Add a credit line in the same style as the existing entries (bullet + table row if `CREDITS.md` has both — match its format):
```markdown
- [GSD Core](https://github.com/open-gsd/gsd-core) by open-gsd (MIT) is the recommended workflow backbone whose Discuss→Plan→Execute→Verify→Ship phases map onto the PAI flow; referenced, not vendored.
```

- [ ] **Step 6: Run to verify GREEN**

Run: `bash tests/docs-continuity.sh && bash verify.sh && sh -n scripts/install-gsd.sh`
Expected: 3 new assertions ok; verify.sh exit 0; `install-gsd.sh` passes `sh` syntax check.

- [ ] **Step 7: Commit**

```bash
git add scripts/install-gsd.sh UPSTREAM.md CREDITS.md tests/docs-continuity.sh
git commit -m "docs+install: realign GSD reference to open-gsd/gsd-core (npx, /gsd-* commands)"
```

---

## Task 5: ISA additions — ISC-34–37

**Files:**
- Modify: `ISA.md`
- Modify (append assertions): `tests/docs-continuity.sh`

**Interfaces:**
- Produces: `ISA.md` contains four new ISC criteria referencing the unified flow, gsd-core recommendation, retirement, and UPSTREAM credit.

- [ ] **Step 1: Read the real ISA to find the true highest ISC number**

```bash
grep -oE 'ISC-[0-9]+' ISA.md | sort -t- -k2 -n | tail -1
```
Record the highest existing number (spec assumes 33; if it differs, number the four new criteria consecutively from `max+1` and adjust the labels in Steps 2–3 accordingly).

- [ ] **Step 2: Write the failing assertions**

Append to `tests/docs-continuity.sh` (uses content strings, not fixed numbers, so it survives renumbering):
```bash
# --- A+F Task 5: ISA additive criteria ---
grep -qi "7-phase decision table" "$DIR/ISA.md" && echo "ok - ISA has unified-table criterion" \
  || { echo "FAIL - ISA.md missing unified 7-phase table criterion"; fail=1; }
grep -qi "recommended-default" "$DIR/ISA.md" && grep -q "gsd-core" "$DIR/ISA.md" \
  && echo "ok - ISA has gsd-core recommended-default criterion" \
  || { echo "FAIL - ISA.md missing gsd-core recommended-default criterion"; fail=1; }
grep -qi "redirect stub" "$DIR/ISA.md" && echo "ok - ISA has retirement criterion" \
  || { echo "FAIL - ISA.md missing retirement criterion"; fail=1; }
```

- [ ] **Step 3: Run to verify RED**

Run: `bash tests/docs-continuity.sh`
Expected: FAIL for the three ISA assertions.

- [ ] **Step 4: Append the four criteria to `ISA.md`'s Criteria section**

Add after the current highest ISC line (using the numbers confirmed in Step 1; shown here as 34–37):
```markdown
- [x] ISC-34: `docs/pai-flow.md` contains the unified 7-phase decision table mapping each PAI phase to its gsd-core command(s), superpowers skill, and done-signal.
- [x] ISC-35: gsd-core (`open-gsd/gsd-core`) is documented as the recommended-default workflow backbone with an explicit superpowers-only fallback; `--with-gsd` remains detect-only (ISC-31 preserved).
- [x] ISC-36: `docs/parallel-dispatch.md` and `docs/multi-surface-architecture.md` are retired to redirect stubs pointing at `docs/pai-flow.md`; `package/conductor/routed-execute.sh` is removed.
- [x] ISC-37: `UPSTREAM.md` credits gsd-core with its current URL (`https://github.com/open-gsd/gsd-core`).
```
If `ISA.md` has a separate verification table (the `| ISC-NN | method | ... |` grid seen around line 88+), add matching rows there too, method `text`/`grep`, so the ISA stays internally consistent.

- [ ] **Step 5: Run to verify GREEN**

Run: `bash tests/docs-continuity.sh && bash verify.sh`
Expected: 3 ISA assertions ok; verify.sh exit 0.

- [ ] **Step 6: Commit**

```bash
git add ISA.md tests/docs-continuity.sh
git commit -m "docs(ISA): add ISC-34..37 for unified flow, gsd-core, retirements (additive)"
```

---

## Task 6: Supporting doc spot-updates

**Files:**
- Modify: `docs/skill-clusters.md`
- Modify: `docs/architecture/REFRESH-NEEDED.md`
- Modify: `docs/architecture/DEPENDENCY-GRAPH.md`
- Modify: `docs/architecture/SERVICES.md`
- Modify (append assertion): `tests/docs-continuity.sh`

**Interfaces:**
- Produces: `docs/skill-clusters.md` states it is the discovery/lazy-load layer in the unified flow.

- [ ] **Step 1: Write the failing assertion**

Append to `tests/docs-continuity.sh`:
```bash
# --- A+F Task 6: skill-clusters documented as the discovery layer ---
grep -qi "discovery/lazy-load layer" "$DIR/docs/skill-clusters.md" \
  && echo "ok - skill-clusters.md names its unified-flow role" \
  || { echo "FAIL - skill-clusters.md missing discovery/lazy-load layer statement"; fail=1; }
```

- [ ] **Step 2: Run to verify RED**

Run: `bash tests/docs-continuity.sh`
Expected: FAIL for the skill-clusters assertion.

- [ ] **Step 3: Add the paragraph to `docs/skill-clusters.md`**

Append (or insert near the top, after the intro) this paragraph:
```markdown
## Role in the unified flow

In the unified flow (`docs/pai-flow.md`), skill-clusters is the
**discovery/lazy-load layer** between the gsd-core backbone (which names a skill
to invoke) and the tool inventory (which runs it). Only active-spoke skills are
symlinked into the live skills dir; deferred clusters are resolved on demand via
`~/.agents/skill-clusters/skill-index.json`; archived skills are read from their
indexed path. This is the context-economy mechanism that keeps session startup
lean while every skill stays reachable.
```

- [ ] **Step 4: Spot-update the three architecture markdown docs**

- `docs/architecture/REFRESH-NEEDED.md` — add a line under the current refresh list: `A+F (unify orchestrators): DONE 2026-07-05. Queued follow-ups: sub-projects B (enrichment enforcement), C (skill-chain wiring), D (gsd-core runtime), E (resolver hook parity).`
- `docs/architecture/DEPENDENCY-GRAPH.md` — ensure a gsd-core edge is present labeled **recommended** (not required). If the file lists deps, add: `gsd-core (open-gsd/gsd-core) — recommended workflow backbone, referenced-not-vendored.`
- `docs/architecture/SERVICES.md` — add gsd-core under recommended (not required) services with the npx install note.

(These three are prose spot-edits; keep each addition to 1–3 lines matching the file's existing style. No assertion beyond the skill-clusters one — they are low-risk and covered by the Task 7 human review + regen.)

- [ ] **Step 5: Run to verify GREEN**

Run: `bash tests/docs-continuity.sh && bash verify.sh`
Expected: skill-clusters assertion ok; verify.sh exit 0.

- [ ] **Step 6: Commit**

```bash
git add docs/skill-clusters.md docs/architecture/REFRESH-NEEDED.md docs/architecture/DEPENDENCY-GRAPH.md docs/architecture/SERVICES.md tests/docs-continuity.sh
git commit -m "docs: spot-update skill-clusters role + architecture supporting docs for A+F"
```

---

## Task 7: Regenerate the 4 architecture HTML docs + final verification

**Files:**
- Modify (regenerate): `docs/architecture/architecture.html`, `docs/architecture/integration-map.html`, `docs/architecture/session-trace.html`, `docs/architecture/system-internals.html`

**Interfaces:**
- Consumes: the final `docs/pai-flow.md` (Task 1), the deprecations (Task 2), the retirement (Task 3), the gsd-core realignment (Task 4), the ISCs (Task 5).

This task is generation + human review, not grep-TDD — the HTML is a rendered view, judged against spec §7's intent.

- [ ] **Step 1: Regenerate via the `architecture-diagram-creator` skill**

Invoke `visual-documentation-skills:architecture-diagram-creator` (the skill `architecture.html:140` says these were generated with) pointed at the repo, with `docs/pai-flow.md`, `ISA.md`, and `UPSTREAM.md` as the source of truth. Produce updated versions of all four HTML files reflecting:
- `architecture.html` — overview; drop the "routed through parallel-dispatch.md" line; show PAI-shell / gsd-core-backbone / skill-cluster layer.
- `integration-map.html` — skill-cluster resolver as a documented layer; GSD status → recommended (still detect-only, ISC-31 preserved); parallel-dispatch seam simplified; conductor row removed.
- `session-trace.html` — degrade-gracefully walkthrough: one trace with gsd-core present, one failure-mode row for gsd-core absent → superpowers fallback; install pointer is `npx @opengsd/gsd-core@latest`.
- `system-internals.html` — `install-gsd.sh` section reflects the permissive gsd-core detection + npx guidance.

- [ ] **Step 2: Human/reviewer check each regenerated file against spec §7**

For each of the 4 files, confirm: no stale `~/.claude/get-shit-done`-as-required language, no `parallel-dispatch.md`-as-authoritative language, no conductor references, gsd-core URL correct. Fix any drift by hand.

- [ ] **Step 3: Full suite green**

Run:
```bash
for t in tests/router-hardening.sh tests/dispatch-tasklist.sh tests/skill-install.sh tests/wire-batch.sh tests/docs-continuity.sh tests/identity-tool.sh tests/sandbox-install.sh; do
  echo "== $t =="; bash "$t" || echo "!! $t FAILED"; done
bash verify.sh
```
Expected: every suite green; `verify.sh` exit 0.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/*.html
git commit -m "docs(architecture): regenerate HTML views for unified flow (gsd-core, skill-cluster layer, retirements)"
```

---

## Final verification (after all tasks)

- [ ] `bash tests/docs-continuity.sh` — all A+F assertions green (phase rows, gsd-core, skill-cluster resolver, redirect stubs, conductor absent, UPSTREAM credit, ISA criteria, skill-clusters role).
- [ ] `bash verify.sh` — exit 0 (no private paths; all `check_file` targets present, including the retained redirect stubs).
- [ ] `grep -rn "get-shit-done" docs/ scripts/ | grep -v "legacy"` — remaining references are only the intentional back-compat/legacy mentions, not authoritative ones.
- [ ] No `package/conductor/` directory remains.

---

## Spec coverage map (spec § → task)

| Spec § | Task |
|---|---|
| §5 architecture | Task 1 (pai-flow.md) + Task 7 (HTML) |
| §6 per-phase table + doctrine | Task 1 |
| §7 doc surface plan | Tasks 1, 2, 6, 7 |
| §8 gsd-core realignment deltas | Task 4 |
| §9 conductor retirement | Task 3 |
| §10 ISC-34–37 | Task 5 |
| §11 test strategy | Tasks 1–6 (assertions) + Task 7 (suite green) |
| §3 non-goals (B–E) | not implemented — deferred, tracked as follow-ups |
