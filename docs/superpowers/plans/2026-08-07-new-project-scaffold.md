> **Historical record** (unredacted original maintained privately): this document describes
> work executed against a specific operator machine. Machine-specific paths appear as
> symbolic placeholders (`<OPERATOR_HOME>`, `<PROJECT_VOLUME>`, `<SESSION_STORE>`); the
> narrative and decisions are unchanged.

# New-Project Scaffolding Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `new-project` subcommand to `scripts/vault-project-relocation.ts` that scaffolds a new client/internal project in the vault with a real six-file relocation packet, a `git init`'d working tree, workflow-derived stage folders (when the project's `--type` matches a skill-clusters delivery workflow), and a fresh, matchable entry in the canonical work-object registry.

**Architecture:** Three new pure/thin `package/relocation/` modules — `project-scaffold.ts` (synthesizes `PacketEvidence` for a repository that doesn't exist yet), `workflow-provenance.ts` (resolves a project type against the skill-clusters workflow registry and digests the entry consumed), `work-object-registry-write.ts` (the first-ever write path onto `work-object-registry.v1.json`) — wired together by one new CLI subcommand that mirrors `draft-packets`' existing shape (manual flag parsing, pure-function calls, owner-only receipt write).

**Tech Stack:** TypeScript on Bun, zero third-party dependencies (Node built-ins only: `node:fs`, `node:path`, `node:crypto`, `node:child_process`), `bun:test` for tests.

## Global Constraints

- Every new module lives in `package/relocation/`, following the existing pure-logic / thin-CLI-wrapper split — no filesystem/git/network access inside pure functions (`project-scaffold.ts`, the pure half of `workflow-provenance.ts`).
- `--kind` accepts exactly `sapling` or `program`, matching `RegistryWorkObject.kind: "sapling" | "program"` in `package/relocation/packet-evidence.ts` — confirmed by direct re-read of the type, not assumed.
- The six-file packet schema (`REQUIRED_PACKET_FILES`, `renderPacket`, `validateProjectYaml`) is closed and must not be modified by this plan. The workflow-provenance digest lives in a separate `.project/WORKFLOW.md`, outside the packet.
- `commands.verify` must never be `"not-applicable"` — `project-packet-schema.ts`'s `validateCommands` explicitly rejects that literal string for `verify` (it's fine for `setup`/`test`). The scaffold's fallback verify command is `"true"`, matching `packet-evidence.ts`'s own existing fallback in `selectCommands`.
- Every mutating file write uses the same owner-only `0o700` directory / `0o600` file permission idiom already used throughout this package (`writeOwnerOnly`/`writeOwnerOnlyText` in `scripts/vault-project-relocation.ts`, `writeRegistryEntry` in `project-registry.ts`).
- Digests are always computed fresh at the point of use, never trusted from caller input — the same discipline as `stableManifestDigest`/`packetDigest`/`registryBaselineDigest` elsewhere in this package.
- No task in this plan ever commits anything to git on behalf of the operator — `new-project` prepares an uncommitted, reviewable scaffold, matching `draft-packets`' "prepare, never auto-commit" discipline.
- No task in this plan touches `project-registry.ts`, `entry.json`, or the `apply`/relocation flow — those remain untouched, as scoped in the design's "Out of scope" section.

---

### Task 1: `project-scaffold.ts` — synthesize evidence for a project that doesn't exist yet

**Files:**
- Create: `package/relocation/project-scaffold.ts`
- Test: `package/relocation/project-scaffold.test.ts`

**Interfaces:**
- Consumes: `PacketEvidence` (type, from `./packet-evidence`) — no changes to that file.
- Produces: `ScaffoldInput` (interface), `synthesizeScaffoldEvidence(input: ScaffoldInput): PacketEvidence` — consumed by Task 4's CLI wiring.

- [ ] **Step 1: Write the failing test**

```typescript
// package/relocation/project-scaffold.test.ts
import { describe, expect, test } from "bun:test";

import { synthesizeScaffoldEvidence } from "./project-scaffold";
import { renderPacket } from "./packet-draft";
import { parseFlatProjectYaml } from "./project-packet";
import { validateProjectYaml } from "./project-packet-schema";

const INPUT = {
  projectId: "client-x",
  portfolio: "thoughtseed" as const,
  repository: "client-x",
  workObjectId: "sapling:client-x",
  workObjectName: "Client X",
  workObjectKind: "sapling" as const,
};

describe("synthesizeScaffoldEvidence", () => {
  test("carries the caller-supplied identity fields through unchanged", () => {
    const evidence = synthesizeScaffoldEvidence(INPUT);
    expect(evidence.projectId).toBe("client-x");
    expect(evidence.portfolio).toBe("thoughtseed");
    expect(evidence.repository).toBe("client-x");
    expect(evidence.workObjectId).toBe("sapling:client-x");
    expect(evidence.workObjectName).toBe("Client X");
    expect(evidence.workObjectKind).toBe("sapling");
    expect(evidence.githubIdentity).toBeUndefined();
  });

  test("starts identityStatus pending-teamforge-verification, since nothing has been verified yet", () => {
    const evidence = synthesizeScaffoldEvidence(INPUT);
    expect(evidence.identityStatus).toBe("pending-teamforge-verification");
  });

  test("flags knowledge_ref and every command as needing review, never fabricating a value", () => {
    const evidence = synthesizeScaffoldEvidence(INPUT);
    expect(evidence.knowledgeRefIsPlaceholder).toBe(true);
    expect(evidence.needsReview).toEqual([
      "knowledge_ref",
      "commands.setup",
      "commands.test",
      "commands.verify",
    ]);
  });

  test("verifyCommand defaults to the true no-op, never the rejected not-applicable literal", () => {
    const evidence = synthesizeScaffoldEvidence(INPUT);
    expect(evidence.verifyCommand).toBe("true");
    expect(evidence.setupCommand).toBe("not-applicable");
    expect(evidence.testCommand).toBe("not-applicable");
  });

  test("renderPacket output validates against the real, unmodified packet schema", () => {
    const evidence = synthesizeScaffoldEvidence(INPUT);
    const files = renderPacket(evidence);
    const parsed = parseFlatProjectYaml(files[".project/project.yaml"]);
    const result = validateProjectYaml(parsed, { approvedLanes: ["te-plan", "te-review"] });
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test package/relocation/project-scaffold.test.ts`
Expected: FAIL — `Cannot find module './project-scaffold'` (the file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

```typescript
// package/relocation/project-scaffold.ts
/**
 * Synthesizes PacketEvidence for a project that doesn't exist yet, rather
 * than reading one from an existing repository (which is what
 * gatherPacketEvidence, in packet-evidence.ts, does). Every field the
 * scaffold operation cannot actually know yet is an explicit,
 * needsReview-flagged placeholder — the caller-supplied identity fields
 * are the only thing not flagged, since those really are known at
 * scaffold time.
 */

import type { PacketEvidence } from "./packet-evidence";

export interface ScaffoldInput {
  projectId: string;
  portfolio: "thoughtseed" | "tryambakam-noesis";
  repository: string;
  workObjectId: string;
  workObjectName: string;
  workObjectKind: "sapling" | "program";
}

export function synthesizeScaffoldEvidence(input: ScaffoldInput): PacketEvidence {
  return {
    projectId: input.projectId,
    portfolio: input.portfolio,
    repository: input.repository,
    workObjectId: input.workObjectId,
    workObjectName: input.workObjectName,
    workObjectKind: input.workObjectKind,
    githubIdentity: undefined,
    identityStatus: "pending-teamforge-verification",
    knowledgeRef: "00-meta/system-of-records.md",
    knowledgeRefIsPlaceholder: true,
    setupCommand: "not-applicable",
    testCommand: "not-applicable",
    verifyCommand: "true",
    needsReview: ["knowledge_ref", "commands.setup", "commands.test", "commands.verify"],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test package/relocation/project-scaffold.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-scaffold.ts package/relocation/project-scaffold.test.ts
git commit -m "feat(relocation): synthesize packet evidence for a new, not-yet-existing project"
```

---

### Task 2: `workflow-provenance.ts` — resolve a project type against the skill-clusters workflow registry

**Files:**
- Create: `package/relocation/workflow-provenance.ts`
- Test: `package/relocation/workflow-provenance.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `WorkflowProvenance` (interface: `{ workflowId: string; stages: string[]; workflowDigest: string }`), `resolveWorkflowProvenance(typeId: string, workflowRegistryPath: string): WorkflowProvenance | null`, `renderWorkflowProvenanceMd(provenance: WorkflowProvenance): string` — both consumed by Task 4's CLI wiring.

- [ ] **Step 1: Write the failing test**

```typescript
// package/relocation/workflow-provenance.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveWorkflowProvenance, renderWorkflowProvenanceMd } from "./workflow-provenance";

const FIXTURE_REGISTRY = {
  version: 2,
  workflows: [
    {
      id: "website-delivery",
      title: "Website delivery factory",
      summary: "Brand lock -> composition -> motion/assets -> frontend -> ship.",
      doc: "~/.agents/skill-clusters/docs/website-delivery-workflow.html",
      plan_template: "~/.agents/skill-clusters/workflows/templates/website-delivery.PLAN.md",
      triggers: { prompt_any: ["website"] },
      stages: [
        { id: "0-discover", label: "Discovery / brief", search_query: "q", skills: ["swarm-architect"] },
        { id: "1-brand", label: "Brand & design cortex", search_query: "q", skills: ["design-orchestrator"] },
      ],
    },
  ],
};

describe("resolveWorkflowProvenance", () => {
  let dir: string;
  let registryPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "workflow-provenance-fixture-"));
    registryPath = join(dir, "registry.json");
    writeFileSync(registryPath, JSON.stringify(FIXTURE_REGISTRY));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a matched type returns its stage ids in order and a sha256 digest", () => {
    const result = resolveWorkflowProvenance("website-delivery", registryPath);
    expect(result).not.toBeNull();
    expect(result?.workflowId).toBe("website-delivery");
    expect(result?.stages).toEqual(["0-discover", "1-brand"]);
    expect(result?.workflowDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("an unmatched type returns null, not an error", () => {
    const result = resolveWorkflowProvenance("app-delivery", registryPath);
    expect(result).toBeNull();
  });

  test("a missing registry file returns null, not an error", () => {
    const result = resolveWorkflowProvenance("website-delivery", join(dir, "does-not-exist.json"));
    expect(result).toBeNull();
  });

  test("the digest is stable across repeated calls against unchanged input", () => {
    const first = resolveWorkflowProvenance("website-delivery", registryPath);
    const second = resolveWorkflowProvenance("website-delivery", registryPath);
    expect(first?.workflowDigest).toBe(second?.workflowDigest);
  });

  test("the digest changes when the consumed workflow entry changes", () => {
    const before = resolveWorkflowProvenance("website-delivery", registryPath);
    const changed = {
      ...FIXTURE_REGISTRY,
      workflows: [
        {
          ...FIXTURE_REGISTRY.workflows[0],
          stages: [
            ...FIXTURE_REGISTRY.workflows[0].stages,
            { id: "2-composition", label: "Composition path", search_query: "q", skills: [] },
          ],
        },
      ],
    };
    writeFileSync(registryPath, JSON.stringify(changed));
    const after = resolveWorkflowProvenance("website-delivery", registryPath);
    expect(after?.workflowDigest).not.toBe(before?.workflowDigest);
    expect(after?.stages).toEqual(["0-discover", "1-brand", "2-composition"]);
  });
});

describe("renderWorkflowProvenanceMd", () => {
  test("renders the workflow id, every stage as a folder reference, and the digest", () => {
    const text = renderWorkflowProvenanceMd({
      workflowId: "website-delivery",
      stages: ["0-discover", "1-brand"],
      workflowDigest: "a".repeat(64),
    });
    expect(text).toContain("website-delivery");
    expect(text).toContain("0-discover/");
    expect(text).toContain("1-brand/");
    expect(text).toContain("a".repeat(64));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test package/relocation/workflow-provenance.test.ts`
Expected: FAIL — `Cannot find module './workflow-provenance'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// package/relocation/workflow-provenance.ts
/**
 * Resolves a project type against the skill-clusters delivery-workflow
 * registry (~/.agents/skill-clusters/workflows/registry.json) and digests
 * the exact workflow entry consumed, so a later drift in that external,
 * independently-evolving registry is a provable fact rather than a silent
 * one. Returns null (never an error) when no workflow matches typeId, or
 * when the registry file doesn't exist — new-project falls back to a
 * fixed-folder-only scaffold in either case.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

interface WorkflowStage {
  id: string;
  label: string;
  search_query: string;
  skills: string[];
  agents_skills?: string[];
}

interface WorkflowEntry {
  id: string;
  title: string;
  summary: string;
  doc: string;
  plan_template: string;
  triggers: Record<string, unknown>;
  stages: WorkflowStage[];
  first_action?: string;
  intensity_note?: string;
}

interface WorkflowRegistryFile {
  workflows: WorkflowEntry[];
}

export interface WorkflowProvenance {
  workflowId: string;
  stages: string[];
  workflowDigest: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveWorkflowProvenance(
  typeId: string,
  workflowRegistryPath: string,
): WorkflowProvenance | null {
  if (!existsSync(workflowRegistryPath)) return null;
  const registry = JSON.parse(readFileSync(workflowRegistryPath, "utf8")) as WorkflowRegistryFile;
  const entry = registry.workflows.find((workflow) => workflow.id === typeId);
  if (!entry) return null;
  return {
    workflowId: entry.id,
    stages: entry.stages.map((stage) => stage.id),
    workflowDigest: sha256(JSON.stringify(entry)),
  };
}

export function renderWorkflowProvenanceMd(provenance: WorkflowProvenance): string {
  return `# Workflow provenance

This project was scaffolded against the \`${provenance.workflowId}\` delivery
workflow defined in \`~/.agents/skill-clusters/workflows/registry.json\`.

## Stages

${provenance.stages.map((stage) => `- \`${stage}/\``).join("\n")}

## Digest

\`${provenance.workflowDigest}\`

This is a sha256 digest of the exact workflow entry consumed at scaffold
time. If the source workflow definition changes later, a fresh
recomputation will no longer match this value — a provable signal of
drift, not a silent one.

This file is not part of the six-file relocation packet. It records
workflow-provenance only and carries no relocation-readiness meaning of
its own.
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test package/relocation/workflow-provenance.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add package/relocation/workflow-provenance.ts package/relocation/workflow-provenance.test.ts
git commit -m "feat(relocation): resolve project type against the skill-clusters workflow registry"
```

---

### Task 3: `work-object-registry-write.ts` — the first write path onto `work-object-registry.v1.json`

**Files:**
- Create: `package/relocation/work-object-registry-write.ts`
- Test: `package/relocation/work-object-registry-write.test.ts`

**Interfaces:**
- Consumes: `CanonicalRegistry`, `RegistryWorkObject` (types, from `./packet-evidence`) — no changes to that file.
- Produces: `NewWorkObjectRegistration` (interface: `{ workObject: RegistryWorkObject; sourceInventoryPath: string }`), `writeWorkObjectEntry(registryPath: string, registration: NewWorkObjectRegistration): void` — consumed by Task 4's CLI wiring.

- [ ] **Step 1: Write the failing test**

```typescript
// package/relocation/work-object-registry-write.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeWorkObjectEntry } from "./work-object-registry-write";
import type { CanonicalRegistry } from "./packet-evidence";

let dir: string;
let registryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "work-object-registry-write-fixture-"));
  registryPath = join(dir, "work-object-registry.v1.json");
});

afterEach(() => {
  chmodSync(dir, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

describe("writeWorkObjectEntry", () => {
  test("creates a new registry file with the WorkObject and a matching sourceInventory entry, when none existed", () => {
    writeWorkObjectEntry(registryPath, {
      workObject: {
        workId: "sapling:client-x",
        name: "Client X",
        kind: "sapling",
        sourceRefs: ["repo:client-x"],
      },
      sourceInventoryPath: "/vault/thoughtseed/client-x",
    });
    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as CanonicalRegistry;
    expect(registry.workObjects).toHaveLength(1);
    expect(registry.workObjects[0].workId).toBe("sapling:client-x");
    expect(registry.sourceInventory).toHaveLength(1);
    expect(registry.sourceInventory[0]).toEqual({
      path: "/vault/thoughtseed/client-x",
      workRefs: ["sapling:client-x"],
    });
  });

  test("appends to an existing registry file without disturbing prior entries", () => {
    const existing: CanonicalRegistry = {
      workObjects: [{ workId: "sapling:existing", name: "Existing", kind: "sapling", sourceRefs: ["repo:existing"] }],
      sourceInventory: [{ path: "/vault/thoughtseed/existing", workRefs: ["sapling:existing"] }],
    };
    writeFileSync(registryPath, JSON.stringify(existing));

    writeWorkObjectEntry(registryPath, {
      workObject: { workId: "sapling:client-x", name: "Client X", kind: "sapling", sourceRefs: ["repo:client-x"] },
      sourceInventoryPath: "/vault/thoughtseed/client-x",
    });

    const registry = JSON.parse(readFileSync(registryPath, "utf8")) as CanonicalRegistry;
    expect(registry.workObjects.map((w) => w.workId)).toEqual(["sapling:existing", "sapling:client-x"]);
    expect(registry.sourceInventory.map((s) => s.path)).toEqual([
      "/vault/thoughtseed/existing",
      "/vault/thoughtseed/client-x",
    ]);
  });

  test("refuses to overwrite on a workId collision", () => {
    const existing: CanonicalRegistry = {
      workObjects: [{ workId: "sapling:client-x", name: "Client X (old)", kind: "sapling", sourceRefs: ["repo:client-x"] }],
      sourceInventory: [{ path: "/vault/thoughtseed/client-x", workRefs: ["sapling:client-x"] }],
    };
    writeFileSync(registryPath, JSON.stringify(existing));

    expect(() =>
      writeWorkObjectEntry(registryPath, {
        workObject: { workId: "sapling:client-x", name: "Client X (new)", kind: "sapling", sourceRefs: ["repo:client-x"] },
        sourceInventoryPath: "/vault/thoughtseed/client-x-2",
      }),
    ).toThrow("work_object_already_exists:sapling:client-x");
  });

  test("refuses to overwrite on a sourceInventory path collision, even with a distinct workId", () => {
    const existing: CanonicalRegistry = {
      workObjects: [{ workId: "sapling:client-x", name: "Client X", kind: "sapling", sourceRefs: ["repo:client-x"] }],
      sourceInventory: [{ path: "/vault/thoughtseed/client-x", workRefs: ["sapling:client-x"] }],
    };
    writeFileSync(registryPath, JSON.stringify(existing));

    expect(() =>
      writeWorkObjectEntry(registryPath, {
        workObject: { workId: "sapling:client-y", name: "Client Y", kind: "sapling", sourceRefs: ["repo:client-y"] },
        sourceInventoryPath: "/vault/thoughtseed/client-x",
      }),
    ).toThrow("source_inventory_path_already_exists:/vault/thoughtseed/client-x");
  });

  test("writes the registry file and its directory with owner-only permissions", () => {
    writeWorkObjectEntry(registryPath, {
      workObject: { workId: "sapling:client-x", name: "Client X", kind: "sapling", sourceRefs: ["repo:client-x"] },
      sourceInventoryPath: "/vault/thoughtseed/client-x",
    });
    expect(statSync(registryPath).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test package/relocation/work-object-registry-write.test.ts`
Expected: FAIL — `Cannot find module './work-object-registry-write'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// package/relocation/work-object-registry-write.ts
/**
 * Writes a new WorkObject entry into work-object-registry.v1.json — the
 * first write path onto this registry (every existing reader,
 * gatherPacketEvidence included in packet-evidence.ts, only ever matches
 * candidates against entries that already exist).
 *
 * Writes two things atomically, not one: the WorkObject itself, and a
 * matching sourceInventory entry mapping the new project's real vault path
 * to its workId. Both are required — a WorkObject with no sourceInventory
 * entry would be unreachable, since matchCandidateToWorkObject (in
 * packet-evidence.ts) looks a folder up by its sourceInventory entry
 * first, never by scanning workObjects directly.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { CanonicalRegistry, RegistryWorkObject } from "./packet-evidence";

export interface NewWorkObjectRegistration {
  workObject: RegistryWorkObject;
  sourceInventoryPath: string;
}

export function writeWorkObjectEntry(registryPath: string, registration: NewWorkObjectRegistration): void {
  let registry: CanonicalRegistry = { workObjects: [], sourceInventory: [] };
  if (existsSync(registryPath)) {
    registry = JSON.parse(readFileSync(registryPath, "utf8")) as CanonicalRegistry;
    if (registry.workObjects.some((existing) => existing.workId === registration.workObject.workId)) {
      throw new Error(`work_object_already_exists:${registration.workObject.workId}`);
    }
    if (registry.sourceInventory.some((existing) => existing.path === registration.sourceInventoryPath)) {
      throw new Error(`source_inventory_path_already_exists:${registration.sourceInventoryPath}`);
    }
  }
  registry.workObjects.push(registration.workObject);
  registry.sourceInventory.push({
    path: registration.sourceInventoryPath,
    workRefs: [registration.workObject.workId],
  });
  mkdirSync(dirname(registryPath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(registryPath), 0o700);
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  chmodSync(registryPath, 0o600);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test package/relocation/work-object-registry-write.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add package/relocation/work-object-registry-write.ts package/relocation/work-object-registry-write.test.ts
git commit -m "feat(relocation): write new WorkObject + sourceInventory entries to the canonical registry"
```

---

### Task 4: Wire the `new-project` CLI subcommand

**Files:**
- Modify: `scripts/vault-project-relocation.ts`
- Test: `tests/vault-project-relocation-new-project.test.ts`

**Interfaces:**
- Consumes: `synthesizeScaffoldEvidence`, `ScaffoldInput` (Task 1); `resolveWorkflowProvenance`, `renderWorkflowProvenanceMd`, `WorkflowProvenance` (Task 2); `writeWorkObjectEntry`, `NewWorkObjectRegistration` (Task 3); `renderPacket` (existing, `packet-draft.ts`); `validateProjectYaml`, `parseFlatProjectYaml` (existing); `isCanonicalRepositoryBasename` (existing, already imported at the top of this file); `PORTFOLIO_ROOTS`, `writeOwnerOnly`, `sha256` (existing, defined earlier in this same file).
- Produces: the `new-project` subcommand itself — nothing later in this plan consumes it as code (Task 5 only documents/wires-in-tests around it).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/vault-project-relocation-new-project.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fixtureRoot: string;
let vaultRoot: string;
let registryPath: string;
let workflowRegistryPath: string;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "new-project-fixture-"));
  vaultRoot = join(fixtureRoot, "thoughtseed");
  mkdirSync(vaultRoot, { recursive: true });

  registryPath = join(fixtureRoot, "work-object-registry.v1.json");
  writeFileSync(registryPath, JSON.stringify({ workObjects: [], sourceInventory: [] }));

  workflowRegistryPath = join(fixtureRoot, "workflows-registry.json");
  writeFileSync(
    workflowRegistryPath,
    JSON.stringify({
      workflows: [
        {
          id: "website-delivery",
          title: "Website delivery factory",
          summary: "s",
          doc: "d",
          plan_template: "p",
          triggers: {},
          stages: [
            { id: "0-discover", label: "Discovery", search_query: "q", skills: [] },
            { id: "1-brand", label: "Brand", search_query: "q", skills: [] },
          ],
        },
      ],
    }),
  );
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function runNewProject(args: string[]): { stdout: string } {
  const stdout = execFileSync(
    "bun",
    [
      join(import.meta.dir, "..", "scripts", "vault-project-relocation.ts"),
      "new-project",
      "--vault-root",
      vaultRoot,
      "--portfolio",
      "thoughtseed",
      "--registry-path",
      registryPath,
      ...args,
    ],
    { encoding: "utf8" },
  );
  return { stdout };
}

describe("new-project CLI subcommand", () => {
  test("matched type: scaffolds the packet, git init, stage folders, WORKFLOW.md, and a registry entry", () => {
    runNewProject([
      "--name",
      "client-x",
      "--kind",
      "sapling",
      "--type",
      "website-delivery",
      "--workflow-registry-path",
      workflowRegistryPath,
      "--output",
      join(fixtureRoot, "receipt.json"),
    ]);

    const target = join(vaultRoot, "client-x");
    for (const file of ["PROJECT.md", "AGENTS.md", "CLAUDE.md", ".project/CONTEXT.md", ".project/project.yaml", ".project/HANDOFF.md"]) {
      expect(existsSync(join(target, file))).toBe(true);
    }
    expect(existsSync(join(target, ".git"))).toBe(true);
    expect(existsSync(join(target, ".project/WORKFLOW.md"))).toBe(true);
    expect(existsSync(join(target, "0-discover"))).toBe(true);
    expect(existsSync(join(target, "1-brand"))).toBe(true);

    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(registry.workObjects).toHaveLength(1);
    expect(registry.workObjects[0].workId).toBe("sapling:client-x");
    expect(registry.sourceInventory[0].path).toBe(target);

    const receipt = JSON.parse(readFileSync(join(fixtureRoot, "receipt.json"), "utf8"));
    expect(receipt.target).toBe(target);
    expect(receipt.workId).toBe("sapling:client-x");
    expect(receipt.stages).toEqual(["0-discover", "1-brand"]);
  });

  test("unmatched type: scaffolds fixed-folder-only, no error, no WORKFLOW.md, no stage folders", () => {
    runNewProject([
      "--name",
      "client-y",
      "--kind",
      "program",
      "--type",
      "app-delivery",
      "--workflow-registry-path",
      workflowRegistryPath,
      "--output",
      join(fixtureRoot, "receipt.json"),
    ]);

    const target = join(vaultRoot, "client-y");
    expect(existsSync(join(target, "PROJECT.md"))).toBe(true);
    expect(existsSync(join(target, ".project/WORKFLOW.md"))).toBe(false);

    const receipt = JSON.parse(readFileSync(join(fixtureRoot, "receipt.json"), "utf8"));
    expect(receipt.stages).toEqual([]);
  });

  test("no --type at all: scaffolds fixed-folder-only, no error", () => {
    runNewProject(["--name", "client-z", "--kind", "sapling", "--output", join(fixtureRoot, "receipt.json")]);
    const target = join(vaultRoot, "client-z");
    expect(existsSync(join(target, "PROJECT.md"))).toBe(true);
    expect(existsSync(join(target, ".project/WORKFLOW.md"))).toBe(false);
  });

  test("--dry-run writes nothing to disk", () => {
    runNewProject([
      "--name",
      "client-dry",
      "--kind",
      "sapling",
      "--output",
      join(fixtureRoot, "receipt.json"),
      "--dry-run",
    ]);
    expect(existsSync(join(vaultRoot, "client-dry"))).toBe(false);
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(registry.workObjects).toHaveLength(0);
    const receipt = JSON.parse(readFileSync(join(fixtureRoot, "receipt.json"), "utf8"));
    expect(receipt.dryRun).toBe(true);
    expect(receipt.target).toBe(join(vaultRoot, "client-dry"));
  });

  test("fails with no write when the target folder already exists", () => {
    mkdirSync(join(vaultRoot, "client-taken"), { recursive: true });
    expect(() =>
      runNewProject(["--name", "client-taken", "--kind", "sapling", "--output", join(fixtureRoot, "receipt.json")]),
    ).toThrow();
    expect(existsSync(join(fixtureRoot, "receipt.json"))).toBe(false);
  });

  test("fails when workId already exists in the registry, leaving the folder scaffold in place", () => {
    writeFileSync(
      registryPath,
      JSON.stringify({
        workObjects: [{ workId: "sapling:client-dup", name: "Dup", kind: "sapling", sourceRefs: ["repo:client-dup"] }],
        sourceInventory: [{ path: "/somewhere/else/client-dup", workRefs: ["sapling:client-dup"] }],
      }),
    );
    expect(() =>
      runNewProject(["--name", "client-dup", "--kind", "sapling", "--output", join(fixtureRoot, "receipt.json")]),
    ).toThrow();
    expect(existsSync(join(vaultRoot, "client-dup", "PROJECT.md"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/vault-project-relocation-new-project.test.ts`
Expected: FAIL — `unknown_argument` or similar, since the `new-project` subcommand doesn't exist yet (the CLI falls through to `usage()` and exits 2, which `execFileSync` surfaces as a thrown error even for the tests not expecting one).

- [ ] **Step 3: Write minimal implementation**

**3a. Add the three new imports** near the existing `packet-evidence`/`packet-draft` imports (after line 41 of `scripts/vault-project-relocation.ts`):

```typescript
import { synthesizeScaffoldEvidence, type ScaffoldInput } from "../package/relocation/project-scaffold";
import { resolveWorkflowProvenance, renderWorkflowProvenanceMd } from "../package/relocation/workflow-provenance";
import { writeWorkObjectEntry } from "../package/relocation/work-object-registry-write";
```

**3a-2. Widen `writeOwnerOnly` to a generic function.** It exists solely to
`JSON.stringify` whatever it's given with owner-only permissions — its
body has no dependency on `InventoryReport` specifically. The scaffold
receipt is a different shape entirely, so rather than force a mismatched
cast at the call site, widen the signature (line 622) from:

```typescript
function writeOwnerOnly(output: string, report: InventoryReport): void {
```

to:

```typescript
function writeOwnerOnly<T>(output: string, report: T): void {
```

This is behavior-preserving for both existing call sites (`plan`'s
`InventoryReport` write and `inventory`'s own) — `T` simply infers as
`InventoryReport` there, exactly as before. No other line in the function
body changes.

**3b. Add `new-project` to the usage text.** In the `usage()` function (starting at line 130), append to the template literal right after the existing `draft-packets` block (before the closing backtick on line 161):

```typescript
  bun scripts/vault-project-relocation.ts new-project \
    --vault-root <absolute-portfolio-root> \
    --portfolio thoughtseed|tryambakam-noesis \
    --name <new-repository-basename> \
    --kind sapling|program \
    --registry-path <absolute-work-object-registry.v1.json-path> \
    [--type <skill-clusters-workflow-id>] \
    [--workflow-registry-path <absolute-workflows/registry.json-path>] \
    --output <owner-only-receipt.json> \
    [--dry-run]`);
```

(This replaces the old closing `` ` ``); ``` at the end of the `usage()` template literal with the block above followed by the closing backtick.)

**3c. Add the subcommand branch.** In the main `try { ... }` dispatcher, add a new `else if (argv[0] === "new-project")` branch immediately before the final `} else { usage(); }` (i.e., right after the existing `draft-packets` branch's closing brace, currently around line 915-916):

```typescript
  } else if (argv[0] === "new-project") {
    let vaultRoot = "";
    let portfolio: Portfolio | "" = "";
    let name = "";
    let kind: "sapling" | "program" | "" = "";
    let registryPath = "";
    let typeId = "";
    let workflowRegistryPath = "";
    let output = "";
    let dryRun = false;
    for (let i = 1; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === "--vault-root") vaultRoot = argv[++i] ?? "";
      else if (arg === "--portfolio") {
        const value = argv[++i];
        if (value !== "thoughtseed" && value !== "tryambakam-noesis") {
          throw new Error(`portfolio_not_allowed:${value ?? ""}`);
        }
        portfolio = value;
      } else if (arg === "--name") name = argv[++i] ?? "";
      else if (arg === "--kind") {
        const value = argv[++i];
        if (value !== "sapling" && value !== "program") {
          throw new Error(`kind_not_allowed:${value ?? ""}`);
        }
        kind = value;
      } else if (arg === "--registry-path") registryPath = argv[++i] ?? "";
      else if (arg === "--type") typeId = argv[++i] ?? "";
      else if (arg === "--workflow-registry-path") workflowRegistryPath = argv[++i] ?? "";
      else if (arg === "--output") output = argv[++i] ?? "";
      else if (arg === "--dry-run") dryRun = true;
      else throw new Error(`unknown_argument:${arg}`);
    }
    if (!vaultRoot || !portfolio || !name || !kind || !registryPath || !output) {
      throw new Error(
        "new_project_requires_vault_root_portfolio_name_kind_registry_path_and_output",
      );
    }
    if (!isCanonicalRepositoryBasename(name)) {
      throw new Error(`repository_basename_invalid:${JSON.stringify(name)}`);
    }

    const target = join(vaultRoot, name);
    if (existsSync(target)) {
      throw new Error(`scaffold_target_exists:${target}`);
    }

    const provenance =
      typeId && workflowRegistryPath ? resolveWorkflowProvenance(typeId, workflowRegistryPath) : null;

    const workObjectId = `${kind}:${name}`;
    const scaffoldInput: ScaffoldInput = {
      projectId: name,
      portfolio,
      repository: name,
      workObjectId,
      workObjectName: name,
      workObjectKind: kind,
    };
    const evidence = synthesizeScaffoldEvidence(scaffoldInput);
    const files = renderPacket(evidence);

    const parsedYaml = parseFlatProjectYaml(files[".project/project.yaml"]);
    const validation = validateProjectYaml(parsedYaml, { approvedLanes: approvedLanes() });
    if (!validation.valid) {
      throw new Error(`synthesized_packet_invalid:${validation.errors.join("; ")}`);
    }

    // Pre-flight the registry write against the read-only current state so
    // both --dry-run and a real run report the exact same collision
    // outcome, without writing anything during the check itself.
    const existingRegistry = existsSync(registryPath)
      ? (JSON.parse(readFileSync(registryPath, "utf8")) as CanonicalRegistry)
      : { workObjects: [], sourceInventory: [] };
    const workIdCollision = existingRegistry.workObjects.some((entry) => entry.workId === workObjectId);
    const pathCollision = existingRegistry.sourceInventory.some((entry) => entry.path === target);

    const receipt = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      dryRun,
      target,
      portfolio,
      name,
      kind,
      workId: workObjectId,
      type: provenance?.workflowId ?? null,
      stages: provenance?.stages ?? [],
      workflowDigest: provenance?.workflowDigest ?? null,
      needsReview: evidence.needsReview,
      registryCollision: workIdCollision || pathCollision,
    };

    if (dryRun) {
      writeOwnerOnly(resolve(output), receipt);
      console.log(JSON.stringify({ output: resolve(output), dryRun: true, target, workId: workObjectId }));
    } else {
      // Deliberately no pre-flight collision throw here (workIdCollision/
      // pathCollision above feed only the receipt's reporting field). The
      // folder and packet files are written first regardless, and
      // writeWorkObjectEntry — called last — is what actually throws on a
      // real collision. This ordering matters: the folder half of a
      // scaffold is inert on its own (no registry claim, no relocation
      // eligibility) and safe to leave in place for the operator to
      // resolve, so a collision must surface after those writes, not
      // before them, matching the design's documented Error Handling
      // behavior.
      mkdirSync(target, { recursive: true });
      const gitInit = spawnSync("git", ["init", "--quiet", "-b", "main"], { cwd: target });
      if (gitInit.status !== 0) throw new Error(`git_init_failed:${target}`);

      for (const [relativePath, content] of Object.entries(files)) {
        const fullPath = join(target, relativePath);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, "utf8");
      }

      if (provenance) {
        writeFileSync(join(target, ".project/WORKFLOW.md"), renderWorkflowProvenanceMd(provenance), "utf8");
        for (const stage of provenance.stages) {
          mkdirSync(join(target, stage), { recursive: true });
        }
      }

      writeWorkObjectEntry(registryPath, {
        workObject: {
          workId: workObjectId,
          name,
          kind,
          sourceRefs: [`repo:${name}`],
        },
        sourceInventoryPath: target,
      });

      writeOwnerOnly(resolve(output), receipt);
      console.log(JSON.stringify({ output: resolve(output), dryRun: false, target, workId: workObjectId }));
    }
  } else {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/vault-project-relocation-new-project.test.ts`
Expected: PASS (6 tests).

Run also, to confirm nothing existing broke: `bun test package/relocation/packet-evidence.test.ts package/relocation/packet-draft.test.ts tests/vault-project-relocation-draft-packets.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 5: Commit**

```bash
git add scripts/vault-project-relocation.ts tests/vault-project-relocation-new-project.test.ts
git commit -m "feat(relocation): wire the new-project CLI subcommand"
```

---

### Task 5: Documentation and test-suite wiring

**Files:**
- Modify: `docs/vault-project-relocation.md`
- Modify: `scripts/verify-all.sh`

**Interfaces:**
- Consumes: nothing new — this task only documents and wires in tests already written by Tasks 1-4.
- Produces: nothing consumed by later tasks (this is the final task in this plan).

- [ ] **Step 1: Add a `## New project` section to `docs/vault-project-relocation.md`**

Insert immediately after the existing `## Draft packets` section (which ends at line 191, right before the `## Dry-run and the exact approval digest` section):

```markdown
## New project

Scaffolds a brand-new project directly in the vault: a `git init`'d
working tree, all six packet files (`packet_status: draft-held`, same as
`draft-packets`), and a fresh, matchable entry in the canonical registry
(`work-object-registry.v1.json`) — both a `WorkObject` and the
`sourceInventory` entry that makes it findable via `matchCandidateToWorkObject`
later. Every field this tool cannot actually know at scaffold time
(`knowledge_ref`, all three `commands.*`) is flagged in `needsReview`, the
same never-fabricate discipline `draft-packets` follows.

```text
bun scripts/vault-project-relocation.ts new-project \
  --vault-root <absolute-portfolio-root> \
  --portfolio thoughtseed|tryambakam-noesis \
  --name <new-repository-basename> \
  --kind sapling|program \
  --registry-path <absolute-work-object-registry.v1.json-path> \
  [--type <skill-clusters-workflow-id>] \
  [--workflow-registry-path <absolute-workflows/registry.json-path>] \
  --output <owner-only-receipt.json> \
  [--dry-run]
```

`--type` is optional. When it names a workflow that exists in the
skill-clusters delivery-workflow registry
(`~/.agents/skill-clusters/workflows/registry.json` — pass its path via
`--workflow-registry-path`), the scaffold gets one subfolder per workflow
stage (e.g. `0-discover/`, `1-brand/`, … for `website-delivery`) and a
`.project/WORKFLOW.md` recording the workflow id, its stage list, and a
sha256 digest of the exact workflow entry consumed — a later change to
that external registry becomes provable, not silent. Omitting `--type`, or
naming a type with no matching workflow entry, is not an error: the
scaffold is fixed-folder-only in that case.

Nothing is committed by this command — the new project sits in the vault
as an uncommitted, reviewable `git`-initialized working tree, exactly like
a freshly-drafted packet, until a human reviews it, resolves the flagged
fields, and makes the first real commit.

`--dry-run` reports the target path, resolved stage folders, workflow
digest, and any registry collision without writing anything. Without
`--dry-run`, a collision on the target folder already existing, on the
minted `workId`, or on the `sourceInventory` path is a hard error — the
target folder and `workId` are minted as
`<vault-root>/<name>` and `<kind>:<name>` respectively, so picking an
already-used `--name` for the given `--portfolio`/`--kind` fails closed
rather than silently overwriting anything.
```

- [ ] **Step 2: Wire the four new test files into `scripts/verify-all.sh`**

Add these four lines immediately after the existing `run bun test tests/vault-project-relocation-draft-packets.test.ts` line:

```bash
run bun test package/relocation/project-scaffold.test.ts
run bun test package/relocation/workflow-provenance.test.ts
run bun test package/relocation/work-object-registry-write.test.ts
run bun test tests/vault-project-relocation-new-project.test.ts
```

- [ ] **Step 3: Run the full aggregation script to confirm everything is wired correctly**

Run: `bash scripts/verify-all.sh 2>&1 | grep -E "new-project|project-scaffold|workflow-provenance|work-object-registry-write"`
Expected: four lines, each showing the test file ran (bun test's own pass/fail summary for each file — no `FAIL` anywhere in this filtered output). The pre-existing, unrelated `private local path found in public/install surface` failure (from `docs/vault-project-relocation.md`'s own pre-existing `<PROJECT_VOLUME>/...` references, present before this plan's work and out of scope for it) is expected and not a regression introduced by this task — do not attempt to fix it as part of this plan.

- [ ] **Step 4: Commit**

```bash
git add docs/vault-project-relocation.md scripts/verify-all.sh
git commit -m "docs(relocation): document new-project and wire its tests into verify-all.sh"
```
