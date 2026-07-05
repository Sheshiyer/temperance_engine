# Unify the Three Routing Brains — Design

**Issue:** #6 — Unify the three routing brains (`route-task.sh` + `multi-backend-router.sh` + `routing.ts`).

**Status:** design (awaiting user review before writing-plans).

---

## 1. Problem

Task routing lives in three separate, drifting implementations:

1. `package/router/route-task.sh` (265 ln) — a bash decision tree emitting an **executor** taxonomy (`inline` / `subagent` / `team` / `command-code`). **Zero live consumers** (repo-wide grep).
2. `package/router/multi-backend-router.sh` (578 ln, "MBR") — the real router: `declare -A` model catalog, 7-type classifier, backend detection + availability gating, priority/fallback chains, and the `--route-only` / `--route-only-with-fallbacks` / `--list-backends` / `--json` output contracts consumed by `dispatch-tasklist.sh` (the `temperance-batch` CLI) and the tests.
3. `package/enrich/stages/routing.ts` (93 ln) — a TypeScript enrichment stage that runs on **every prompt** (live hook) and emits an advisory `routing:` line.

They diverge in three ways that are latent bugs:

- **Task-type classifier drift (1b in the analysis):** the same prompt lands in different buckets. `routing.ts` checks `fast` *first*; MBR checks `long-horizon` first — so `"quick refactor"` classifies as `fast` in the hook but `long-horizon` in the router. Keyword sets also differ (`restructure`, `across.*files`, `understand|think|difficult`, `find|count`, `grep|build|compile` each appear in only a subset).
- **`routing.ts` multi-backend bug:** it advertises `backends=command-code,grok,nvidia` but its `getPreferred()` table is `command-code:*` / `inline:*` only, so it **always** emits `preferred=command-code:…` regardless of the backend list.
- **Missing auth gate in `routing.ts`:** it detects `command-code` with `command -v` only; MBR additionally requires `command-code status | grep Authenticated`. (This divergence is intentional for the hook — see Decision D6 — but it is undocumented drift today.)

The model tables otherwise **agree on the happy path** (fast / long-horizon / validation / creative / balanced → identical `command-code` models), which is what makes unification tractable.

---

## 2. Goal

Collapse the three into **one authoritative router** that produces three verdicts:

- `inline` — trivial one-shot (extraction, no tool use).
- `external(backend, model)` — self-contained work routable to an external backend.
- `claude-subagent` — needs the live Claude session.

Every routing surface (the dispatch CLI, the enrichment hook) derives its output from this one classification, so drift is structurally impossible.

---

## 3. Decisions (locked — from the brainstorm)

| # | Decision | Rationale |
|---|----------|-----------|
| **D1** | **MBR is the single source of truth** (Approach A). It gains a verdict layer; the other two stop classifying independently. | MBR has the most consumers and the most complete classifier; keeps the bash dispatch path Node-free; least net new surface. |
| **D2** | `claude-subagent` = **fallback when no external backend is available.** It reinterprets MBR's existing `none` sentinel; no new positive classifier is invented in v1. | Simplest faithful mapping; avoids inventing a "needs-session" signal none of the brains compute today. |
| **D3** | `external` is **always `command-code:<model>`.** grok/kimi stay reachable only via dispatch's #8 fallback chain and explicit `--backend`; never auto-preferred. | Matches `routing.ts`'s current reality and the earlier "grok/kimi as fallback only" scoping. Contracts C1–C2 unchanged. |
| **D4** | **`route-task.sh` is deleted.** Its `subagent`(Architect) / `team`(coordination) axes are dropped. | Zero live consumers; no slot in the 3-verdict target; re-addable later if orchestration needs it. |
| **D5** | **`confidence` is dropped.** | Only `route-task.sh` emitted it, hardcoded; no consumer reads it. |
| **D6** | The **canonical task-type classifier is extracted into a small POSIX-sh unit** (`package/router/classify-task.sh`) that MBR sources and `routing.ts` execs. `routing.ts` keeps its own **fast** backend detection for the advisory line. | See §5.1. A per-prompt exec of *bash-5-dependent MBR* is ruled out by `routing.test.ts`, which runs the hook under a **stripped `PATH=/usr/bin:/bin`** (system bash 3.2, no `declare -A`/`mapfile`). A tiny POSIX-sh classifier runs under any `/bin/sh`, carries **one copy** of the regex + type→model table, and fails open. This keeps "MBR is source of truth" (MBR owns the unit) while staying Node-free and bash-version-safe. |

---

## 4. Non-goals (YAGNI)

- **Not** rewriting `dispatch-tasklist.sh` — it consumes `--route-only`, which stays byte-for-byte identical.
- **Not** changing any other enrichment stage or the hook pipeline order.
- **Not** adding a positive "needs-session" classifier (D2 keeps `claude-subagent` as the no-external fallback).
- **Not** making grok/kimi/nvidia auto-preferred (D3).
- **Not** introducing a Node/`bun` dependency into the bash dispatch path.

---

## 5. Architecture

### 5.0 Components after unification

| File | Role after this change |
|------|------------------------|
| `package/router/classify-task.sh` **(new)** | POSIX-sh single source of task-type truth: `classify-task.sh "<task>"` → one line `<task_type>\t<backend>:<model>`. Pure (no backend detection). Owns the ordered regex table **and** the type→model catalog. |
| `package/router/multi-backend-router.sh` (harden, additive) | Sources `classify-task.sh` for classification (its inline classifier + `MODEL_CATALOG` type→model rows are replaced by the shared unit). Gains a `--verdict` mode. Existing modes/contracts unchanged. Retains backend detection, availability gating, priority/fallback chains, catalogs for kimi/grok/nvidia. |
| `package/enrich/stages/routing.ts` (rewrite internals) | Deletes `classifyTaskType()` + `getPreferred()`; execs `classify-task.sh` for `task_type` + `preferred`. Keeps `detectBackends()` (fast, test-pinned). Renders the same `routing:` line. |
| `package/router/route-task.sh` | **Deleted.** |

### 5.1 The shared classifier — `classify-task.sh`

POSIX sh (`#!/usr/bin/env sh`, no bashisms), so it runs under `/bin/sh`, macOS system bash, and homebrew bash alike.

- **Input:** `$1` = task text (may be empty).
- **Output:** exactly one line to stdout: `<task_type><TAB><backend>:<model>`, exit 0.
- **Logic:** the reconciled ordered classifier (see §6). Uses `grep -Eq` against a lowercased copy of the input; first match wins. Emits the type and its catalog model.
- **No backend detection, no availability gating** — pure text→type→model. That belongs to MBR (D6 keeps the hot path fast and env-independent).

Canonical ordered table (the reconciliation of the three drifting copies — see §6 for the exact merge and the resolved `"quick refactor"` contradiction):

| Order | type | regex (extended, lowercased input) | model |
|------|------|-----------------------------------|-------|
| 1 | `long-horizon` | `refactor\|rewrite\|migrate\|redesign\|overhaul\|restructure\|entire\|all files\|across.*files` | `command-code:moonshotai/Kimi-K2.7-Code` |
| 2 | `reasoning` | `analyze\|debug\|diagnose\|explain\|understand\|reason\|think\|complex\|difficult` | `command-code:claude-fable-5` |
| 3 | `validation` | `validate\|verify\|review\|check\|audit\|test\|ensure\|confirm` | `command-code:google/gemini-3.5-flash` |
| 4 | `creative` | `brainstorm\|creative\|design\|explore\|imagine\|ideate\|alternative` | `command-code:claude-sonnet-5` |
| 5 | `fast` | `quick\|simple\|small\|minor\|tweak\|fix typo\|update comment` | `command-code:deepseek/deepseek-v4-flash` |
| 6 | `inline` | positive `extract\|classify\|summarize\|list\|identify\|find\|count` **AND NOT** `read\|search\|grep\|edit\|write\|run\|execute\|test\|build\|compile` | `inline:current-session` |
| 7 | `balanced` (default) | — | `command-code:claude-sonnet-5` |

This adopts **MBR's ordering and its (superset) keyword lists** as canonical, because MBR is the authoritative router (D1) and its consumers (`--route-only`, tests) already depend on that ordering. The behavioural change is therefore isolated to `routing.ts` (whose `fast`-first ordering and trimmed keyword sets are abandoned) — an intended correction, not a regression, since no test pins `routing.ts`'s `task=` value (see §7).

### 5.2 MBR verdict layer — `--verdict`

New additive mode: `multi-backend-router.sh --verdict "<task>"` → exactly one line, exit 0:

- `inline` — when the shared classifier returns type `inline`.
- `external<TAB>command-code<TAB><model>` — when the task is non-trivial **and** an external backend (command-code, per D3) is available after MBR's authoritative detection + auth gate.
- `claude-subagent` — when non-trivial **and** no external backend is available (D2; the reinterpreted `none` case).

The verdict is computed *from the same internal state* that `--route-only` already uses, so `--route-only` becomes a rendering of the verdict:

| verdict | `--route-only` line (unchanged contract C1) |
|---------|---------------------------------------------|
| `external(command-code, M)` | `command-code<TAB>M` |
| `inline` | `inline<TAB>-` |
| `claude-subagent` | `none<TAB>-` |

`--route-only`, `--route-only-with-fallbacks`, `--list-backends`, and `--json` keep their exact current output (C1–C3, C5). `--json` gains an additive `verdict` field; existing consumers reading `.task_type`/`.backend`/`.model` are unaffected.

### 5.3 `routing.ts` after the rewrite

```
detectBackends()            // KEPT verbatim (fast: command -v / existsSync / env) — test-pinned
if backends.length === 0 → { line: '', degraded: false }     // unchanged
taskType, preferred ← exec `classify-task.sh "<prompt>"`     // replaces classifyTaskType()+getPreferred()
                                                              // on ANY exec failure → fall back to 'balanced'
                                                              //   / command-code:claude-sonnet-5 (fail-open)
line = `routing: backends=${backends.join(',')} | task=${taskType} | preferred=${preferred} | skill=temperance-parallel-dispatch`
catch → { line: '', degraded: true }                         // unchanged
```

The `routing:` line format, the empty-line zero-backends branch, and the trailing `| skill=temperance-parallel-dispatch` segment are **identical** to today (contract C6). Only the *source* of `task`/`preferred` changes (shared unit instead of a local copy), which incidentally fixes nothing in the line shape but removes the drift.

> Note the `routing.ts` multi-backend "always command-code" behaviour is now **correct by decision** (D3: command-code is the sole auto-preferred), not a bug — `preferred` is legitimately `command-code:<model>` even when `backends` lists more.

---

## 6. Classifier reconciliation (the drift merge)

The canonical table in §5.1 is the union that resolves every 1b divergence:

- **Ordering:** MBR's order wins (`long-horizon → reasoning → validation → creative → fast → inline → balanced`). This resolves the live contradiction: `"quick refactor"` → **`long-horizon`** (was `fast` in `routing.ts`). `"analyze and refactor"` → `long-horizon` (refactor matched before reasoning), consistent with MBR today.
- **Keywords:** the superset is taken so no prompt silently changes bucket versus MBR — `restructure`/`across.*files` (long-horizon), `understand`/`think`/`difficult` (reasoning), `ensure`/`confirm` (validation), `ideate`/`alternative` (creative), `small`/`update comment` (fast), `find`/`count` + the `grep`/`test`/`build`/`compile` negative guards (inline).
- **Models:** the agreed happy-path catalog (identical across MBR and `routing.ts` today) becomes the one copy.

A **parity smoke test** (see §8) asserts a fixed corpus of prompts classifies identically whether routed through `classify-task.sh` directly or through MBR (which sources it), so the two never re-drift.

---

## 7. Consumer contracts preserved (regression-guarded)

| ID | Contract | Producer | Consumers | Guard |
|----|----------|----------|-----------|-------|
| C1 | `--route-only`: one line `BACKEND\tMODEL` \| `inline\t-` \| `none\t-`, exit 0 | MBR | `dispatch-tasklist.sh`, `tests/router-hardening.sh`, `tests/dispatch-tasklist.sh` | existing tests |
| C2 | `--route-only-with-fallbacks`: priority lines, **nvidia never appears** | MBR | `dispatch-tasklist.sh` `route_fallbacks()`, tests | existing test pins nvidia-absent |
| C3 | `--list-backends`: `Available backends: …` | MBR | `dispatch-tasklist.sh` (→ `TEMPERANCE_BACKENDS`), `parallel-backend-dispatch.sh` | existing tests |
| C5 | `--json`: `.task_type`/`.backend`/`.model` (+ new `.verdict`) | MBR | `parallel-backend-dispatch.sh` | additive; existing keys unchanged |
| C6 | `routing:` line shape + trailing skill pointer + empty zero-backend branch | `routing.ts` | enrichment hook `index.ts` (passes `.line` verbatim) | `routing.test.ts` |
| C8 | public CLI symlinks | `scripts/wire-multi-backend.sh` | install | update if any file path changes |

**`routing.test.ts` specifically pins** (must stay green): line starts `routing: backends=`, contains `| task=` / `| preferred=`, **ends with** `| skill=temperance-parallel-dispatch`; the clean-env (`PATH=/usr/bin:/bin`) case returns `line===''`; the fake-`command-code`-shim case (a bare `exit 0` stub with **no** `status` subcommand) returns a non-empty line containing `backends=command-code`. The last one is why `detectBackends()` must remain a `command -v` check (D6) and why the classifier must run under system `/bin/sh`.

---

## 8. Testing

**New:**
- `tests/classify-task.sh` — unit tests for the shared classifier: each of the 7 buckets (incl. the reconciled `"quick refactor"→long-horizon`, `"analyze and refactor"→long-horizon`, inline positive+negative guards), exact `type\tbackend:model` output, empty-input → `balanced`.
- `tests/router-verdict.sh` (or an added block in `tests/router-hardening.sh`) — `--verdict` emits `inline` / `external\tcommand-code\t<model>` / `claude-subagent` for representative tasks and matching backend-availability states (drive availability via `TEMPERANCE_BACKENDS`); assert the `--verdict`↔`--route-only` mapping (external↔`BACKEND\tMODEL`, inline↔`inline\t-`, claude-subagent↔`none\t-`).
- **Parity test** — a fixed prompt corpus classifies identically via `classify-task.sh` alone and via MBR sourcing it.

**Regression (must stay green, unchanged):** `tests/router-hardening.sh` (C1/C2/C3), `tests/dispatch-tasklist.sh`, `package/enrich/stages/routing.test.ts` (C6), plus `verify.sh` and the full suite.

**Removed:** any test referencing `route-task.sh` (grep first; none expected given zero consumers, but confirm).

---

## 9. Error handling / fail-open

- `classify-task.sh` never errors on odd input; empty/no-match → `balanced\tcommand-code:claude-sonnet-5`.
- `routing.ts` execs the classifier inside its existing `try`; **any** failure (missing script, non-zero, unparseable) → fall back to `balanced`/`command-code:claude-sonnet-5`, still emit a well-formed line (or `{ line:'', degraded:true }` if the outer try trips). The hook never throws.
- MBR `--verdict` fails open to `claude-subagent` if classification or detection is indeterminate (never silently claims an external backend).
- Deleting `route-task.sh`: grep the repo (docs, `wire-*.sh`, ISA) for references and update/remove them in the same change so nothing dangles.

---

## 10. Rollout / rollback

- Additive-first: `classify-task.sh` + `--verdict` land and are tested before `route-task.sh` is deleted and `routing.ts` is rewired, so each step is independently green.
- Rollback = revert the branch; no data migration, no external state. MBR's public contracts are unchanged throughout, so `dispatch-tasklist.sh` and `temperance-batch` are never at risk.

---

## 11. ISA impact

Additive ISC entries recording the unified-router invariant (one classifier, three verdicts, command-code-sole-preferred, `route-task.sh` retired). Annotate any existing ISC that referenced the three-brains state as superseded. (Exact numbers assigned during planning against the current ISA max.)

---

## 12. Verified gap register (implementation must satisfy)

1. `--route-only` / `--route-only-with-fallbacks` / `--list-backends` / `--json` output is byte-identical to pre-change for the existing test corpus (nvidia still absent from fallbacks).
2. `routing.test.ts` passes unmodified, including the fake-`command-code`-shim case (classifier runs under `/bin/sh` with stripped PATH).
3. `"quick refactor"` classifies as `long-horizon` everywhere (no surface still says `fast`).
4. `routing.ts` no longer contains an independent task-type or type→model table (grep proves the deletion).
5. `route-task.sh` is gone and unreferenced (grep proves no dangling consumers).
6. `--verdict` and `--route-only` agree on every mapping for the test corpus.
7. Full suite + `verify.sh` green on homebrew bash 5.x; `classify-task.sh` additionally green under `/bin/sh`.
