# Manifest Algorithm Activation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Manifest telemetry deterministic, Algorithm-only, project-scoped, and safe across the selected portfolios.

**Architecture:** The PAI classifier emits the canonical activation event through a shared bridge helper. The helper resolves a real Git root, evaluates a host-owned allowlist, persists per-session run metadata, and gives later lifecycle hooks a correlation boundary. The bridge remains a projection and never enrolls or executes a repository.

**Tech Stack:** Bun, TypeScript, Node filesystem APIs, local JSONL bridge, React/Vite manifest console.

**Spec:** `docs/MANIFEST-ALGORITHM-ACTIVATION-GAP-REGISTER.md`

## Global Constraints

- Default deny outside an explicit host allowlist.
- Normalize identity to `realpath` plus Git worktree root.
- Do not write inside an observed-only project.
- Persist no raw prompt or tool body.
- Keep swarm approval and execution authority unchanged.

### Task 1: Test activation and project identity boundaries

**Files:**
- Modify: `package/manifest-bridge/test/bridge.test.ts`
- Test: `package/manifest-bridge/test/bridge.test.ts`

- [ ] Write failing tests for Algorithm-only acceptance, Git-root normalization, rejected roots, unenrolled candidates, active-run persistence, and closed-run rejection.
- [ ] Run `bun test test/bridge.test.ts` and confirm each new test fails because activation helpers do not exist.
- [ ] Commit only after the helper implementation passes.

### Task 2: Implement policy, identity, and run registry

**Files:**
- Create: `package/manifest-bridge/src/activation.ts`
- Modify: `package/manifest-bridge/src/project.ts`
- Modify: `package/manifest-bridge/src/store.ts`

- [ ] Add a versioned allowlist policy and default-deny resolver.
- [ ] Resolve identity from real Git root and validate registered manifests.
- [ ] Persist one atomic activation record per session and project all run fields.
- [ ] Run `bun test test/bridge.test.ts` and confirm green.

### Task 3: Wire PAI adapters without parallel-hook inference

**Files:**
- Modify: `~/.claude/hooks/PromptProcessing.hook.ts`
- Modify: `~/.claude/hooks/ManifestEvent.hook.ts`
- Modify: `enrich/adapters/claude-prompthook.ts`
- Modify: `enrich/adapters/codex-prompthook.ts`

- [ ] Emit activation only after the classifier resolves its context.
- [ ] Gate generic lifecycle telemetry on a persisted active run.
- [ ] Keep every adapter fail-open and payload-bounded.
- [ ] Verify each adapter with synthetic JSON input.

### Task 4: Surface the state and document operation

**Files:**
- Modify: `package/manifest-bridge/README.md`
- Modify: `docs/manifest-control-plane.md`
- Modify: `integrations/manifest-skill-137/manifest-zone/src/pages.tsx`
- Modify: `integrations/manifest-skill-137/manifest-zone/src/manifest.ts`

- [ ] Render observed-only/enrolled and active-run mode/tier state.
- [ ] Document policy setup, passive observation, bridge startup, and rollback.
- [ ] Run `npm run lint` and `npm run build` in `manifest-zone`.

### Task 5: Verify behavior, documentation, and scoped live flow

**Files:**
- Modify: `docs/MANIFEST-ALGORITHM-ACTIVATION-GAP-REGISTER.md`

- [ ] Run full bridge tests and visual build.
- [ ] Start an ephemeral bridge and submit a synthetic Algorithm activation for Cambium.
- [ ] Confirm Native and out-of-scope inputs leave no project event.
- [ ] Update the gap register only with evidence-backed statuses.
