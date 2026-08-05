# Vault Project Relocation — Session-Map (Piece C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Parallel-dispatch note:** Tasks 2–6 (the OpenCode, Copilot, Codex, Kimi, and Craft Agent matchers) are mutually independent once Task 1 lands — none import from or depend on each other, only on the shared types Task 1 defines. They are the intended candidates for `temperance-parallel-dispatch`/OmniRoute dispatch at execution time rather than serial subagents.

**Goal:** For every project moved by the already-built relocation subsystem (piece A), produce a durable, structured, per-project record of which of six named CLI tools (Claude Code, OpenCode, GitHub Copilot CLI, Codex, Kimi, Craft Agent) had session state keyed to the old path, whether that state is still discoverable after the move, and — for Claude Code specifically — leave a reversible symlink so the tool continues that history at the new path.

**Architecture:** One new module, `package/relocation/project-session-map.ts`, holding six independent, fixture-tested matcher functions (one per tool) behind a shared `ToolMatchResult` interface, an orchestrator (`buildSessionMap`) that runs them against both old and new paths, a Claude-Code-only active relink function (`applyClaudeCodeRelink`) gated never-clobber/reversible, and a writer (`writeSessionMap`) that persists the record to `~/.temperance_engine/session-maps/<portfolio>/<repository>/map.json`, mode `0600`. A new `session-map` CLI subcommand in the existing `scripts/vault-project-relocation.ts` wires it together. The module joins the existing source-guards file and `verify-all.sh` gate.

**Tech Stack:** TypeScript, `bun:test`, `bun:sqlite` (built-in, no new dependency) for the OpenCode/Copilot matchers, Node's `node:fs`/`node:path` for everything else. Matches the existing `package/relocation/*` conventions exactly — no new libraries.

## Global Constraints

- No `homedir()` call or bare `process.env.HOME` read anywhere in `project-session-map.ts` or the CLI additions — all six tool-store paths are hardcoded absolute literals, the same way `REGISTRY_HOST_ROOTS`/`PORTFOLIO_ROOTS` already are in `scripts/vault-project-relocation.ts` (Design §7).
- Every matcher fails closed independently — a malformed/missing file or DB never throws past its own matcher; it becomes `{ matched: false, error: "<reason>" }` (Design §10).
- No matcher ever reads session/transcript file *content* — existence, `stat`, or specific whitelisted structural keys/columns only. Nothing in the module ever references a `.jsonl` file by name (Design §10, §11) — this is a mechanically-checked guard, not just a convention.
- `symlinkSync` is called from exactly one place in the whole module, inside `attemptClaudeCodeRelink` — mechanically checked by a source guard (Design §8).
- The Claude Code relink is never-clobber: only runs when the old session folder exists **and** the new one does not (Design §8).
- All real filesystem/DB *tests* use `mkdtempSync`-created temp fixtures — never the real `~/.claude`, `~/.codex`, `~/.copilot`, `~/.kimi`, `~/.craft-agent`, or `~/.local/share/opencode` directories.
- `session-map` is a standalone CLI subcommand, never folded into `apply` (Design §9, owner decision D5).
- `--no-relink` is the only new flag; relink is default-on for Claude Code (owner decision D7).
- **Import accumulation:** `project-session-map.ts` and `project-session-map.test.ts` are built incrementally across Tasks 1–9, each appending to the same two files. Each task's code block shows new imports inline at the point they're first needed, for readability — when implementing, add each new named import to the **existing** `node:fs` (or other module) import statement already at the top of the file rather than writing a second, colliding `import { ... } from "node:fs"` line. By Task 8/9, the test file's `node:fs` import must include at least `mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, readFileSync` (aliased as needed) and the production file's must include `existsSync, statSync, readFileSync, writeFileSync, mkdirSync, chmodSync, symlinkSync` — consolidate as you go; do not duplicate.

---

### Task 1: Shared types + Claude Code matcher + `encodeClaudeCodeProjectPath`

**Files:**
- Create: `package/relocation/project-session-map.ts`
- Test: `package/relocation/project-session-map.test.ts`

**Interfaces:**
- Produces: `MatchMechanism`, `ToolMatchResult`, `ClaudeCodeRelinkAction`, `SessionMapEntry`, `SessionMapRecord`, `BuildSessionMapInput` (types); `encodeClaudeCodeProjectPath(path: string): string`; `matchClaudeCode(path: string, projectsRoot?: string): ToolMatchResult`. Every later task in this plan imports these types and appends its matcher function to the same file.

- [ ] **Step 1: Write the failing tests**

```typescript
// package/relocation/project-session-map.test.ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeClaudeCodeProjectPath, matchClaudeCode } from "./project-session-map";

describe("encodeClaudeCodeProjectPath", () => {
  test("encodes real, independently-verified paths (slash -> dash, dots preserved)", () => {
    expect(encodeClaudeCodeProjectPath("/Users/sheshnarayaniyer")).toBe("-Users-sheshnarayaniyer");
    expect(encodeClaudeCodeProjectPath("/Users/sheshnarayaniyer/.claude/projects/autoresearch")).toBe(
      "-Users-sheshnarayaniyer-.claude-projects-autoresearch",
    );
    expect(
      encodeClaudeCodeProjectPath(
        "/Volumes/madara/2026/twc-vault/01-Projects/thoughtseed/temperance_engine",
      ),
    ).toBe("-Volumes-madara-2026-twc-vault-01-Projects-thoughtseed-temperance-engine");
  });
});

describe("matchClaudeCode", () => {
  test("matched: true when the encoded session folder exists under the projects root", () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), "claude-projects-"));
    const path = "/Volumes/fixture/thoughtseed/some-repo";
    mkdirSync(join(projectsRoot, encodeClaudeCodeProjectPath(path)));

    const result = matchClaudeCode(path, projectsRoot);

    expect(result).toEqual({
      tool: "claude-code",
      mechanism: "path-derived",
      matched: true,
      locator: join(projectsRoot, "-Volumes-fixture-thoughtseed-some-repo"),
    });
    rmSync(projectsRoot, { recursive: true, force: true });
  });

  test("matched: false when no encoded folder exists", () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), "claude-projects-"));

    const result = matchClaudeCode("/Volumes/fixture/thoughtseed/nonexistent-repo", projectsRoot);

    expect(result).toEqual({ tool: "claude-code", mechanism: "path-derived", matched: false });
    rmSync(projectsRoot, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test package/relocation/project-session-map.test.ts`
Expected: FAIL — `project-session-map.ts` does not exist yet (module not found).

- [ ] **Step 3: Write the minimal implementation**

```typescript
// package/relocation/project-session-map.ts
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export type MatchMechanism =
  | "path-derived"
  | "db-query-match"
  | "workspace-root-index-match"
  | "unsupported";

export interface ToolMatchResult {
  tool: string;
  mechanism: MatchMechanism;
  matched: boolean | null;
  locator?: string;
  error?: string;
}

export type ClaudeCodeRelinkAction =
  | "created"
  | "skipped-destination-exists"
  | "skipped-source-missing";

export interface SessionMapEntry extends ToolMatchResult {
  relinkAction?: ClaudeCodeRelinkAction;
}

export interface SessionMapRecord {
  stableId: string;
  portfolio: string;
  repository: string;
  oldPath: string;
  newPath: string;
  generatedAt: string;
  tools: SessionMapEntry[];
}

export interface BuildSessionMapInput {
  stableId: string;
  portfolio: string;
  repository: string;
  oldPath: string;
  newPath: string;
}

/**
 * Confirmed empirically 2026-08-05 against three real, independently-checked
 * paths: `/` becomes `-`; every other character (including `.` and `_`) is
 * preserved literally. Session folders created inside a Git worktree may
 * carry an additional suffix this function does not attempt to reproduce —
 * that case legitimately reports matched: false via matchClaudeCode, it is
 * not a bug in this transform.
 */
export function encodeClaudeCodeProjectPath(path: string): string {
  return path.replace(/\//g, "-");
}

const CLAUDE_CODE_PROJECTS_ROOT = "/Users/sheshnarayaniyer/.claude/projects";

export function matchClaudeCode(
  path: string,
  projectsRoot: string = CLAUDE_CODE_PROJECTS_ROOT,
): ToolMatchResult {
  const candidate = join(projectsRoot, encodeClaudeCodeProjectPath(path));
  const matched = existsSync(candidate) && statSync(candidate).isDirectory();
  return matched
    ? { tool: "claude-code", mechanism: "path-derived", matched: true, locator: candidate }
    : { tool: "claude-code", mechanism: "path-derived", matched: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-session-map.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-session-map.ts package/relocation/project-session-map.test.ts
git commit -m "feat(relocation): add session-map shared types and Claude Code matcher"
```

---

### Task 2: OpenCode matcher (SQLite)

**Files:**
- Modify: `package/relocation/project-session-map.ts` (append)
- Modify: `package/relocation/project-session-map.test.ts` (append)

**Interfaces:**
- Consumes: `ToolMatchResult` (Task 1).
- Produces: `matchOpenCode(path: string, dbPath?: string): ToolMatchResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to package/relocation/project-session-map.test.ts
import { Database } from "bun:sqlite";
import { matchOpenCode } from "./project-session-map";

describe("matchOpenCode", () => {
  function makeFixtureDb(path: string): void {
    const db = new Database(path, { create: true });
    db.run("CREATE TABLE project (id TEXT PRIMARY KEY)");
    db.run(
      "CREATE TABLE session (project_id TEXT NOT NULL, directory TEXT NOT NULL, path TEXT)",
    );
    db.run("INSERT INTO project (id) VALUES (?)", ["proj-1"]);
    db.run("INSERT INTO session (project_id, directory) VALUES (?, ?)", [
      "proj-1",
      "/Volumes/fixture/thoughtseed/some-repo",
    ]);
    db.close();
  }

  test("matched: true when session.directory equals the given path", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-db-"));
    const dbPath = join(dir, "opencode.db");
    makeFixtureDb(dbPath);

    const result = matchOpenCode("/Volumes/fixture/thoughtseed/some-repo", dbPath);

    expect(result).toEqual({
      tool: "opencode",
      mechanism: "db-query-match",
      matched: true,
      locator: "opencode.db: session.project_id=proj-1",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false when no session row has that directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-db-"));
    const dbPath = join(dir, "opencode.db");
    makeFixtureDb(dbPath);

    const result = matchOpenCode("/Volumes/fixture/thoughtseed/other-repo", dbPath);

    expect(result).toEqual({ tool: "opencode", mechanism: "db-query-match", matched: false });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false with error when the db file does not exist", () => {
    const result = matchOpenCode("/Volumes/fixture/thoughtseed/some-repo", "/nonexistent/opencode.db");

    expect(result.matched).toBe(false);
    expect(result.error).toBe("opencode_db_not_found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test package/relocation/project-session-map.test.ts -t "matchOpenCode"`
Expected: FAIL — `matchOpenCode` is not exported.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// append to package/relocation/project-session-map.ts
import { Database } from "bun:sqlite";

const OPENCODE_DB_PATH = "/Users/sheshnarayaniyer/.local/share/opencode/opencode.db";

export function matchOpenCode(
  path: string,
  dbPath: string = OPENCODE_DB_PATH,
): ToolMatchResult {
  if (!existsSync(dbPath)) {
    return { tool: "opencode", mechanism: "db-query-match", matched: false, error: "opencode_db_not_found" };
  }
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query("SELECT project_id FROM session WHERE directory = ? LIMIT 1")
        .get(path) as { project_id: string } | null;
      return row
        ? {
            tool: "opencode",
            mechanism: "db-query-match",
            matched: true,
            locator: `opencode.db: session.project_id=${row.project_id}`,
          }
        : { tool: "opencode", mechanism: "db-query-match", matched: false };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      tool: "opencode",
      mechanism: "db-query-match",
      matched: false,
      error: `opencode_db_query_failed:${(error as Error).message}`,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-session-map.test.ts`
Expected: PASS, 6 tests total.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-session-map.ts package/relocation/project-session-map.test.ts
git commit -m "feat(relocation): add OpenCode session-map matcher"
```

---

### Task 3: GitHub Copilot CLI matcher (SQLite)

**Files:**
- Modify: `package/relocation/project-session-map.ts` (append)
- Modify: `package/relocation/project-session-map.test.ts` (append)

**Interfaces:**
- Consumes: `ToolMatchResult` (Task 1).
- Produces: `matchCopilot(path: string, dbPath?: string): ToolMatchResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to package/relocation/project-session-map.test.ts
import { matchCopilot } from "./project-session-map";

describe("matchCopilot", () => {
  function makeFixtureDb(path: string): void {
    const db = new Database(path, { create: true });
    db.run(
      "CREATE TABLE projects (id TEXT PRIMARY KEY, main_repo_path TEXT NOT NULL UNIQUE, github_repo TEXT)",
    );
    db.run("INSERT INTO projects (id, main_repo_path, github_repo) VALUES (?, ?, ?)", [
      "proj-1",
      "/Volumes/fixture/thoughtseed/some-repo",
      "Sheshiyer/some-repo",
    ]);
    db.close();
  }

  test("matched: true when projects.main_repo_path equals the given path", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-db-"));
    const dbPath = join(dir, "data.db");
    makeFixtureDb(dbPath);

    const result = matchCopilot("/Volumes/fixture/thoughtseed/some-repo", dbPath);

    expect(result).toEqual({
      tool: "copilot",
      mechanism: "db-query-match",
      matched: true,
      locator: "data.db: projects.main_repo_path=/Volumes/fixture/thoughtseed/some-repo",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false when no project row has that main_repo_path", () => {
    const dir = mkdtempSync(join(tmpdir(), "copilot-db-"));
    const dbPath = join(dir, "data.db");
    makeFixtureDb(dbPath);

    const result = matchCopilot("/Volumes/fixture/thoughtseed/other-repo", dbPath);

    expect(result).toEqual({ tool: "copilot", mechanism: "db-query-match", matched: false });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false with error when the db file does not exist", () => {
    const result = matchCopilot("/Volumes/fixture/thoughtseed/some-repo", "/nonexistent/data.db");

    expect(result.matched).toBe(false);
    expect(result.error).toBe("copilot_db_not_found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test package/relocation/project-session-map.test.ts -t "matchCopilot"`
Expected: FAIL — `matchCopilot` is not exported.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// append to package/relocation/project-session-map.ts
const COPILOT_DB_PATH = "/Users/sheshnarayaniyer/.copilot/data.db";

export function matchCopilot(
  path: string,
  dbPath: string = COPILOT_DB_PATH,
): ToolMatchResult {
  if (!existsSync(dbPath)) {
    return { tool: "copilot", mechanism: "db-query-match", matched: false, error: "copilot_db_not_found" };
  }
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query("SELECT main_repo_path FROM projects WHERE main_repo_path = ? LIMIT 1")
        .get(path) as { main_repo_path: string } | null;
      return row
        ? {
            tool: "copilot",
            mechanism: "db-query-match",
            matched: true,
            locator: `data.db: projects.main_repo_path=${row.main_repo_path}`,
          }
        : { tool: "copilot", mechanism: "db-query-match", matched: false };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      tool: "copilot",
      mechanism: "db-query-match",
      matched: false,
      error: `copilot_db_query_failed:${(error as Error).message}`,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-session-map.test.ts`
Expected: PASS, 9 tests total.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-session-map.ts package/relocation/project-session-map.test.ts
git commit -m "feat(relocation): add GitHub Copilot CLI session-map matcher"
```

---

### Task 4: Codex matcher (workspace-root JSON index)

**Files:**
- Modify: `package/relocation/project-session-map.ts` (append)
- Modify: `package/relocation/project-session-map.test.ts` (append)

**Interfaces:**
- Consumes: `ToolMatchResult` (Task 1).
- Produces: `matchCodex(path: string, globalStatePath?: string): ToolMatchResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to package/relocation/project-session-map.test.ts
import { writeFileSync } from "node:fs";
import { matchCodex } from "./project-session-map";

describe("matchCodex", () => {
  test("matched: true when the path appears in active-workspace-roots", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-state-"));
    const statePath = join(dir, ".codex-global-state.json");
    writeFileSync(
      statePath,
      JSON.stringify({ "active-workspace-roots": ["/Volumes/fixture/thoughtseed/some-repo"] }),
    );

    const result = matchCodex("/Volumes/fixture/thoughtseed/some-repo", statePath);

    expect(result).toEqual({
      tool: "codex",
      mechanism: "workspace-root-index-match",
      matched: true,
      locator: ".codex-global-state.json: active-workspace-roots",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false when the path appears in none of the known keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-state-"));
    const statePath = join(dir, ".codex-global-state.json");
    writeFileSync(statePath, JSON.stringify({ "active-workspace-roots": ["/other/path"] }));

    const result = matchCodex("/Volumes/fixture/thoughtseed/some-repo", statePath);

    expect(result).toEqual({ tool: "codex", mechanism: "workspace-root-index-match", matched: false });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false with error when the state file does not exist", () => {
    const result = matchCodex("/Volumes/fixture/thoughtseed/some-repo", "/nonexistent/.codex-global-state.json");

    expect(result.matched).toBe(false);
    expect(result.error).toBe("codex_global_state_not_found");
  });

  test("matched: false with error when the state file is not valid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-state-"));
    const statePath = join(dir, ".codex-global-state.json");
    writeFileSync(statePath, "{not valid json");

    const result = matchCodex("/Volumes/fixture/thoughtseed/some-repo", statePath);

    expect(result.matched).toBe(false);
    expect(result.error).toContain("codex_global_state_parse_failed");
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test package/relocation/project-session-map.test.ts -t "matchCodex"`
Expected: FAIL — `matchCodex` is not exported.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// append to package/relocation/project-session-map.ts
import { readFileSync } from "node:fs";

const CODEX_GLOBAL_STATE_PATH = "/Users/sheshnarayaniyer/.codex/.codex-global-state.json";
const CODEX_WORKSPACE_ROOT_KEYS = ["active-workspace-roots", "electron-saved-workspace-roots", "project-order"];

export function matchCodex(
  path: string,
  globalStatePath: string = CODEX_GLOBAL_STATE_PATH,
): ToolMatchResult {
  if (!existsSync(globalStatePath)) {
    return {
      tool: "codex",
      mechanism: "workspace-root-index-match",
      matched: false,
      error: "codex_global_state_not_found",
    };
  }
  try {
    const state = JSON.parse(readFileSync(globalStatePath, "utf8")) as Record<string, unknown>;
    for (const key of CODEX_WORKSPACE_ROOT_KEYS) {
      const value = state[key];
      if (Array.isArray(value) && value.includes(path)) {
        return {
          tool: "codex",
          mechanism: "workspace-root-index-match",
          matched: true,
          locator: `.codex-global-state.json: ${key}`,
        };
      }
    }
    return { tool: "codex", mechanism: "workspace-root-index-match", matched: false };
  } catch (error) {
    return {
      tool: "codex",
      mechanism: "workspace-root-index-match",
      matched: false,
      error: `codex_global_state_parse_failed:${(error as Error).message}`,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-session-map.test.ts`
Expected: PASS, 13 tests total.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-session-map.ts package/relocation/project-session-map.test.ts
git commit -m "feat(relocation): add Codex session-map matcher"
```

---

### Task 5: Kimi matcher (`work_dirs` JSON index)

**Files:**
- Modify: `package/relocation/project-session-map.ts` (append)
- Modify: `package/relocation/project-session-map.test.ts` (append)

**Interfaces:**
- Consumes: `ToolMatchResult` (Task 1).
- Produces: `matchKimi(path: string, kimiJsonPath?: string): ToolMatchResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to package/relocation/project-session-map.test.ts
import { matchKimi } from "./project-session-map";

describe("matchKimi", () => {
  test("matched: true when the path appears in work_dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "kimi-json-"));
    const kimiJsonPath = join(dir, "kimi.json");
    writeFileSync(kimiJsonPath, JSON.stringify({ work_dirs: ["/Volumes/fixture/thoughtseed/some-repo"] }));

    const result = matchKimi("/Volumes/fixture/thoughtseed/some-repo", kimiJsonPath);

    expect(result).toEqual({
      tool: "kimi",
      mechanism: "workspace-root-index-match",
      matched: true,
      locator: "kimi.json: work_dirs",
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false when the path is absent from work_dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "kimi-json-"));
    const kimiJsonPath = join(dir, "kimi.json");
    writeFileSync(kimiJsonPath, JSON.stringify({ work_dirs: ["/other/path"] }));

    const result = matchKimi("/Volumes/fixture/thoughtseed/some-repo", kimiJsonPath);

    expect(result).toEqual({ tool: "kimi", mechanism: "workspace-root-index-match", matched: false });
    rmSync(dir, { recursive: true, force: true });
  });

  test("matched: false with error when kimi.json does not exist", () => {
    const result = matchKimi("/Volumes/fixture/thoughtseed/some-repo", "/nonexistent/kimi.json");

    expect(result.matched).toBe(false);
    expect(result.error).toBe("kimi_json_not_found");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test package/relocation/project-session-map.test.ts -t "matchKimi"`
Expected: FAIL — `matchKimi` is not exported.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// append to package/relocation/project-session-map.ts
const KIMI_JSON_PATH = "/Users/sheshnarayaniyer/.kimi/kimi.json";

export function matchKimi(
  path: string,
  kimiJsonPath: string = KIMI_JSON_PATH,
): ToolMatchResult {
  if (!existsSync(kimiJsonPath)) {
    return { tool: "kimi", mechanism: "workspace-root-index-match", matched: false, error: "kimi_json_not_found" };
  }
  try {
    const state = JSON.parse(readFileSync(kimiJsonPath, "utf8")) as { work_dirs?: unknown };
    if (Array.isArray(state.work_dirs) && state.work_dirs.includes(path)) {
      return { tool: "kimi", mechanism: "workspace-root-index-match", matched: true, locator: "kimi.json: work_dirs" };
    }
    return { tool: "kimi", mechanism: "workspace-root-index-match", matched: false };
  } catch (error) {
    return {
      tool: "kimi",
      mechanism: "workspace-root-index-match",
      matched: false,
      error: `kimi_json_parse_failed:${(error as Error).message}`,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-session-map.test.ts`
Expected: PASS, 16 tests total.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-session-map.ts package/relocation/project-session-map.test.ts
git commit -m "feat(relocation): add Kimi session-map matcher"
```

---

### Task 6: Craft Agent matcher (unsupported placeholder)

**Files:**
- Modify: `package/relocation/project-session-map.ts` (append)
- Modify: `package/relocation/project-session-map.test.ts` (append)

**Interfaces:**
- Consumes: `ToolMatchResult` (Task 1).
- Produces: `matchCraftAgent(path: string): ToolMatchResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to package/relocation/project-session-map.test.ts
import { matchCraftAgent } from "./project-session-map";

describe("matchCraftAgent", () => {
  test("always reports unsupported — no per-project convention was found (Design §4/§5)", () => {
    const result = matchCraftAgent("/Volumes/fixture/thoughtseed/some-repo");

    expect(result).toEqual({ tool: "craft-agent", mechanism: "unsupported", matched: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test package/relocation/project-session-map.test.ts -t "matchCraftAgent"`
Expected: FAIL — `matchCraftAgent` is not exported.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// append to package/relocation/project-session-map.ts
export function matchCraftAgent(_path: string): ToolMatchResult {
  return { tool: "craft-agent", mechanism: "unsupported", matched: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-session-map.test.ts`
Expected: PASS, 17 tests total.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-session-map.ts package/relocation/project-session-map.test.ts
git commit -m "feat(relocation): add Craft Agent session-map matcher (unsupported)"
```

---

### Task 7: `buildSessionMap` orchestrator

**Files:**
- Modify: `package/relocation/project-session-map.ts` (append)
- Modify: `package/relocation/project-session-map.test.ts` (append)

**Interfaces:**
- Consumes: `BuildSessionMapInput`, `SessionMapRecord`, `SessionMapEntry` (Task 1), all six `match*` functions (Tasks 1–6).
- Produces: `buildSessionMap(input: BuildSessionMapInput, generatedAt: string, matchers?: Array<(path: string) => ToolMatchResult>): SessionMapRecord`. The optional `matchers` parameter exists solely so this task's tests can inject fixture-backed matchers instead of the six hardcoded-path production ones — production call sites (Task 10) never pass it.
- Precedence rule (must match exactly, see plan note below): for each matcher, check `oldPath` first; if `matched` is `true`, use that result. Otherwise check `newPath`; if `matched` is `true`, use that result. Otherwise use the `oldPath` result (preserves `error`/`unsupported` state).

- [ ] **Step 1: Write the failing test**

```typescript
// append to package/relocation/project-session-map.test.ts
import { buildSessionMap } from "./project-session-map";
import type { ToolMatchResult } from "./project-session-map";

describe("buildSessionMap", () => {
  test("prefers an oldPath match over a newPath match", () => {
    const matcherOld: (path: string) => ToolMatchResult = (path) =>
      path === "old"
        ? { tool: "fixture-tool", mechanism: "path-derived", matched: true, locator: "found-at-old" }
        : { tool: "fixture-tool", mechanism: "path-derived", matched: false };

    const record = buildSessionMap(
      {
        stableId: "stable-1",
        portfolio: "thoughtseed",
        repository: "some-repo",
        oldPath: "old",
        newPath: "new",
      },
      "2026-08-05T00:00:00.000Z",
      [matcherOld],
    );

    expect(record).toEqual({
      stableId: "stable-1",
      portfolio: "thoughtseed",
      repository: "some-repo",
      oldPath: "old",
      newPath: "new",
      generatedAt: "2026-08-05T00:00:00.000Z",
      tools: [{ tool: "fixture-tool", mechanism: "path-derived", matched: true, locator: "found-at-old" }],
    });
  });

  test("falls back to newPath when oldPath does not match", () => {
    const matcherNew: (path: string) => ToolMatchResult = (path) =>
      path === "new"
        ? { tool: "fixture-tool", mechanism: "path-derived", matched: true, locator: "found-at-new" }
        : { tool: "fixture-tool", mechanism: "path-derived", matched: false };

    const record = buildSessionMap(
      {
        stableId: "stable-1",
        portfolio: "thoughtseed",
        repository: "some-repo",
        oldPath: "old",
        newPath: "new",
      },
      "2026-08-05T00:00:00.000Z",
      [matcherNew],
    );

    expect(record.tools).toEqual([
      { tool: "fixture-tool", mechanism: "path-derived", matched: true, locator: "found-at-new" },
    ]);
  });

  test("reports the oldPath result (including error/unsupported) when neither path matches", () => {
    const matcherUnsupported: (path: string) => ToolMatchResult = () => ({
      tool: "fixture-tool",
      mechanism: "unsupported",
      matched: null,
    });

    const record = buildSessionMap(
      {
        stableId: "stable-1",
        portfolio: "thoughtseed",
        repository: "some-repo",
        oldPath: "old",
        newPath: "new",
      },
      "2026-08-05T00:00:00.000Z",
      [matcherUnsupported],
    );

    expect(record.tools).toEqual([{ tool: "fixture-tool", mechanism: "unsupported", matched: null }]);
  });

  test("defaults to all six production matchers when none are injected", () => {
    const record = buildSessionMap(
      {
        stableId: "stable-1",
        portfolio: "thoughtseed",
        repository: "some-repo",
        oldPath: "/nonexistent/old",
        newPath: "/nonexistent/new",
      },
      "2026-08-05T00:00:00.000Z",
    );

    expect(record.tools.map((entry) => entry.tool)).toEqual([
      "claude-code",
      "opencode",
      "copilot",
      "codex",
      "kimi",
      "craft-agent",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test package/relocation/project-session-map.test.ts -t "buildSessionMap"`
Expected: FAIL — `buildSessionMap` is not exported.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// append to package/relocation/project-session-map.ts
const DEFAULT_MATCHERS: Array<(path: string) => ToolMatchResult> = [
  matchClaudeCode,
  matchOpenCode,
  matchCopilot,
  matchCodex,
  matchKimi,
  matchCraftAgent,
];

export function buildSessionMap(
  input: BuildSessionMapInput,
  generatedAt: string,
  matchers: Array<(path: string) => ToolMatchResult> = DEFAULT_MATCHERS,
): SessionMapRecord {
  const tools: SessionMapEntry[] = matchers.map((matcher) => {
    const oldResult = matcher(input.oldPath);
    if (oldResult.matched === true) return oldResult;
    const newResult = matcher(input.newPath);
    return newResult.matched === true ? newResult : oldResult;
  });
  return {
    stableId: input.stableId,
    portfolio: input.portfolio,
    repository: input.repository,
    oldPath: input.oldPath,
    newPath: input.newPath,
    generatedAt,
    tools,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-session-map.test.ts`
Expected: PASS, 21 tests total.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-session-map.ts package/relocation/project-session-map.test.ts
git commit -m "feat(relocation): add buildSessionMap orchestrator"
```

---

### Task 8: `attemptClaudeCodeRelink` + `applyClaudeCodeRelink`

**Files:**
- Modify: `package/relocation/project-session-map.ts` (append)
- Modify: `package/relocation/project-session-map.test.ts` (append)

**Interfaces:**
- Consumes: `ClaudeCodeRelinkAction`, `SessionMapRecord`, `SessionMapEntry` (Task 1), `encodeClaudeCodeProjectPath` (Task 1).
- Produces: `attemptClaudeCodeRelink(oldSessionDir: string, newSessionDir: string): ClaudeCodeRelinkAction`; `applyClaudeCodeRelink(record: SessionMapRecord, projectsRoot?: string): SessionMapRecord`.

- [ ] **Step 1: Write the failing tests**

```typescript
// append to package/relocation/project-session-map.test.ts
import { symlinkSync } from "node:fs";
import { attemptClaudeCodeRelink, applyClaudeCodeRelink } from "./project-session-map";

describe("attemptClaudeCodeRelink", () => {
  test("creates a symlink when the old dir exists and the new dir does not", () => {
    const dir = mkdtempSync(join(tmpdir(), "relink-"));
    const oldDir = join(dir, "old-session");
    const newDir = join(dir, "new-session");
    mkdirSync(oldDir);

    const action = attemptClaudeCodeRelink(oldDir, newDir);

    expect(action).toBe("created");
    expect(statSync(newDir).isSymbolicLink() || statSync(newDir).isDirectory()).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("skips when the new dir already exists — never clobbers", () => {
    const dir = mkdtempSync(join(tmpdir(), "relink-"));
    const oldDir = join(dir, "old-session");
    const newDir = join(dir, "new-session");
    mkdirSync(oldDir);
    mkdirSync(newDir);

    const action = attemptClaudeCodeRelink(oldDir, newDir);

    expect(action).toBe("skipped-destination-exists");
    expect(statSync(newDir).isSymbolicLink()).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("skips when the old dir does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "relink-"));
    const oldDir = join(dir, "old-session");
    const newDir = join(dir, "new-session");

    const action = attemptClaudeCodeRelink(oldDir, newDir);

    expect(action).toBe("skipped-source-missing");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("applyClaudeCodeRelink", () => {
  function baseRecord(overrides: Partial<SessionMapEntry>): SessionMapRecord {
    return {
      stableId: "stable-1",
      portfolio: "thoughtseed",
      repository: "some-repo",
      oldPath: "/Volumes/fixture/thoughtseed/some-repo",
      newPath: "/Volumes/fixture2/thoughtseed/some-repo",
      generatedAt: "2026-08-05T00:00:00.000Z",
      tools: [
        { tool: "claude-code", mechanism: "path-derived", matched: true, locator: "irrelevant", ...overrides },
      ],
    };
  }

  test("relinks and stamps relinkAction: created when claude-code matched at oldPath", () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), "claude-projects-"));
    const record = baseRecord({});
    mkdirSync(join(projectsRoot, encodeClaudeCodeProjectPath(record.oldPath)));

    const result = applyClaudeCodeRelink(record, projectsRoot);

    expect(result.tools[0].relinkAction).toBe("created");
    rmSync(projectsRoot, { recursive: true, force: true });
  });

  test("does not attempt a relink when claude-code did not match", () => {
    const projectsRoot = mkdtempSync(join(tmpdir(), "claude-projects-"));
    const record = baseRecord({ matched: false, locator: undefined });

    const result = applyClaudeCodeRelink(record, projectsRoot);

    expect(result.tools[0].relinkAction).toBeUndefined();
    rmSync(projectsRoot, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test package/relocation/project-session-map.test.ts -t "Relink"`
Expected: FAIL — `attemptClaudeCodeRelink`/`applyClaudeCodeRelink` are not exported.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// append to package/relocation/project-session-map.ts
import { symlinkSync } from "node:fs";

export function attemptClaudeCodeRelink(oldSessionDir: string, newSessionDir: string): ClaudeCodeRelinkAction {
  if (!existsSync(oldSessionDir)) return "skipped-source-missing";
  if (existsSync(newSessionDir)) return "skipped-destination-exists";
  symlinkSync(oldSessionDir, newSessionDir, "dir");
  return "created";
}

export function applyClaudeCodeRelink(
  record: SessionMapRecord,
  projectsRoot: string = CLAUDE_CODE_PROJECTS_ROOT,
): SessionMapRecord {
  const claudeCodeEntry = record.tools.find((entry) => entry.tool === "claude-code");
  if (!claudeCodeEntry || claudeCodeEntry.matched !== true) return record;

  const oldSessionDir = join(projectsRoot, encodeClaudeCodeProjectPath(record.oldPath));
  const newSessionDir = join(projectsRoot, encodeClaudeCodeProjectPath(record.newPath));
  const relinkAction = attemptClaudeCodeRelink(oldSessionDir, newSessionDir);

  return {
    ...record,
    tools: record.tools.map((entry) => (entry.tool === "claude-code" ? { ...entry, relinkAction } : entry)),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-session-map.test.ts`
Expected: PASS, 26 tests total.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-session-map.ts package/relocation/project-session-map.test.ts
git commit -m "feat(relocation): add never-clobber Claude Code active relink"
```

---

### Task 9: `writeSessionMap` I/O

**Files:**
- Modify: `package/relocation/project-session-map.ts` (append)
- Modify: `package/relocation/project-session-map.test.ts` (append)

**Interfaces:**
- Consumes: `SessionMapRecord` (Task 1).
- Produces: `writeSessionMap(filePath: string, record: SessionMapRecord): void`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to package/relocation/project-session-map.test.ts
import { readFileSync as readFileSyncForTest } from "node:fs";
import { writeSessionMap } from "./project-session-map";

describe("writeSessionMap", () => {
  test("writes the record as mode-0600 JSON, creating parent directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "session-map-out-"));
    const filePath = join(dir, "thoughtseed", "some-repo", "map.json");
    const record: SessionMapRecord = {
      stableId: "stable-1",
      portfolio: "thoughtseed",
      repository: "some-repo",
      oldPath: "/old",
      newPath: "/new",
      generatedAt: "2026-08-05T00:00:00.000Z",
      tools: [],
    };

    writeSessionMap(filePath, record);

    const written = JSON.parse(readFileSyncForTest(filePath, "utf8"));
    expect(written).toEqual(record);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test package/relocation/project-session-map.test.ts -t "writeSessionMap"`
Expected: FAIL — `writeSessionMap` is not exported.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// append to package/relocation/project-session-map.ts
import { chmodSync, mkdirSync as mkdirSyncNode, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function writeSessionMap(filePath: string, record: SessionMapRecord): void {
  mkdirSyncNode(dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, JSON.stringify(record, null, 2));
  chmodSync(filePath, 0o600);
}
```

(Note: consolidate the three separate `node:fs` import statements accumulated across Tasks 1–9 into the single existing import block at the top of the file rather than leaving duplicates — this is a mechanical cleanup, not a new behavior, do it as part of this task's commit.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test package/relocation/project-session-map.test.ts`
Expected: PASS, 27 tests total.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-session-map.ts package/relocation/project-session-map.test.ts
git commit -m "feat(relocation): add writeSessionMap I/O and consolidate imports"
```

---

### Task 10: CLI `session-map` subcommand

**Files:**
- Modify: `scripts/vault-project-relocation.ts`
- Modify: `tests/vault-project-relocation.test.ts`

**Interfaces:**
- Consumes: `buildSessionMap`, `applyClaudeCodeRelink`, `writeSessionMap` (Tasks 7–9); `registryEntryPath` (existing, `project-registry.ts`); `inferPortfolio` (existing, `scripts/vault-project-relocation.ts`).
- Produces: a `session-map` branch in the existing `if (argv[0] === "plan") ... else if (...) ...` dispatch chain, and a `usage()` line documenting it.

- [ ] **Step 1: Write the failing test**

```typescript
// append to tests/vault-project-relocation.test.ts
import { spawnSync } from "node:child_process";

describe("session-map subcommand — argument validation only", () => {
  test("missing --repository exits 2 with usage", () => {
    const result = spawnSync("bun", ["scripts/vault-project-relocation.ts", "session-map"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  test("relative --repository path is rejected without touching the filesystem", () => {
    const result = spawnSync(
      "bun",
      ["scripts/vault-project-relocation.ts", "session-map", "--repository", "relative/path"],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/vault-project-relocation.test.ts -t "session-map"`
Expected: FAIL — `session-map` is not a recognized subcommand (falls through to `usage()` today, but the second test's relative-path rejection message won't yet exist for this subcommand specifically since the branch doesn't exist).

- [ ] **Step 3: Write the minimal implementation**

Add the import at the top of `scripts/vault-project-relocation.ts` alongside the existing relocation imports:

```typescript
import {
  buildSessionMap,
  applyClaudeCodeRelink,
  writeSessionMap,
} from "../package/relocation/project-session-map";
```

Add a `session-map` usage line inside the existing `usage()` function's template string, alongside the existing `apply`/`rollback` lines:

```
  bun scripts/vault-project-relocation.ts session-map \
    --repository <absolute-new-path> \
    [--no-relink]
```

Add a new branch to the existing `if (argv[0] === "plan") ... else if (...) ...` chain, immediately before the final `else usage();`:

```typescript
} else if (argv[0] === "session-map") {
  let repository = "";
  let relink = true;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repository") repository = argv[++i] ?? "";
    else if (arg === "--no-relink") relink = false;
  }
  if (!repository || !isAbsolute(repository)) usage();

  const portfolio = inferPortfolio(repository);
  if (!portfolio) throw new Error(`session_map_portfolio_not_inferred:${repository}`);
  const repositoryName = basename(repository);

  const entryPath = registryEntryPath(portfolio, repositoryName);
  const entryFilePath = join(entryPath, "entry.json");
  if (!existsSync(entryFilePath)) {
    throw new Error(`session_map_registry_entry_not_found:${entryFilePath}`);
  }
  const registryEntry = JSON.parse(readFileSync(entryFilePath, "utf8"));

  let record = buildSessionMap(
    {
      stableId: registryEntry.stableId,
      portfolio,
      repository: repositoryName,
      oldPath: registryEntry.oldPath,
      newPath: repository,
    },
    new Date().toISOString(),
  );
  if (relink) {
    record = applyClaudeCodeRelink(record);
  }

  const outputPath = join(
    "/Users/sheshnarayaniyer/.temperance_engine",
    "session-maps",
    portfolio,
    repositoryName,
    "map.json",
  );
  writeSessionMap(outputPath, record);
  console.log(JSON.stringify({ output: outputPath, tools: record.tools }, null, 2));
} else usage();
```

Confirmed (2026-08-05): `scripts/vault-project-relocation.ts` is already in `PRODUCTION_RELOCATION_FILES` (`project-relocation-source-guards.test.ts:33`) and is therefore already covered by the `homedir()`/`process.env.HOME` ban — the literal path above is not a style choice, it's required to keep this task's own tests (Task 11) passing. No new import is needed: `basename`, `existsSync`, `readFileSync`, `join`, and `isAbsolute` are already imported at the top of `scripts/vault-project-relocation.ts` (verified directly).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/vault-project-relocation.test.ts`
Expected: PASS, including the two new tests and every pre-existing test in this file.

- [ ] **Step 5: Commit**

```bash
git add scripts/vault-project-relocation.ts tests/vault-project-relocation.test.ts
git commit -m "feat(relocation): wire session-map CLI subcommand"
```

---

### Task 11: Source-guard extension

**Files:**
- Modify: `package/relocation/project-relocation-source-guards.test.ts`

**Interfaces:**
- Consumes: `PRODUCTION_RELOCATION_FILES`, `readProductionCode`, `assertNoneContain` (all existing in this file).
- Produces: no new exports — extends the existing guard suite with `project-session-map.ts` coverage.

- [ ] **Step 1: Write the failing test**

Add `"package/relocation/project-session-map.ts"` to the existing `PRODUCTION_RELOCATION_FILES` array (this alone will make several existing guard tests in this file start covering the new module — e.g. the `homedir()` guard, the read-only-Git-subcommand guard is unaffected since this module calls no Git).

Then add these new test cases inside the existing `describe("source guards — every production relocation file", ...)` block:

```typescript
  test("project-session-map.ts never reads session/transcript file content — no .jsonl literal anywhere", () => {
    const code = readProductionCode("package/relocation/project-session-map.ts");
    expect(code.includes(".jsonl")).toBe(false);
  });

  test("symlinkSync is called from exactly one production call site", () => {
    const code = readProductionCode("package/relocation/project-session-map.ts");
    const matches = [...code.matchAll(/symlinkSync\s*\(/g)];
    expect(matches.length).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail (then pass, since this is additive to already-implemented code)**

Run: `bun test package/relocation/project-relocation-source-guards.test.ts`
Expected: since Tasks 1–10 already implemented `project-session-map.ts` correctly, adding it to `PRODUCTION_RELOCATION_FILES` and adding these two assertions should PASS immediately — this task is a verification/guard-coverage task, not new production behavior. If any guard fails here, it means an earlier task's implementation violated an invariant; fix the implementation in the relevant earlier task's file, not the guard.

- [ ] **Step 3: (No new production code — this task only extends test coverage.)**

- [ ] **Step 4: Run the full guard suite to confirm**

Run: `bun test package/relocation/project-relocation-source-guards.test.ts`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add package/relocation/project-relocation-source-guards.test.ts
git commit -m "test(relocation): extend source guards to cover project-session-map.ts"
```

---

### Task 12: Wire into `verify-all.sh`, update docs, run full scoped suite, verify no real mutation

**Files:**
- Modify: `scripts/verify-all.sh`
- Modify: `docs/vault-project-relocation.md`

**Interfaces:**
- Consumes: nothing new — this task is integration and documentation only.
- Produces: nothing new — closes out the plan.

- [ ] **Step 1: Add the new test file to `verify-all.sh`**

Add this line to `scripts/verify-all.sh`, alongside the existing `run bun test package/relocation/project-relocation-apply.test.ts` line:

```bash
run bun test package/relocation/project-session-map.test.ts
```

- [ ] **Step 2: Document the subcommand in `docs/vault-project-relocation.md`**

Add a new subsection after the existing "The end-to-end apply transaction" section:

```markdown
## The session-map (piece C)

`session-map --repository <absolute-new-path> [--no-relink]` records, per
project, which of six CLI tools (Claude Code, OpenCode, GitHub Copilot CLI,
Codex, Kimi, Craft Agent) had session state keyed to the project's old vault
path, and whether that state is still discoverable after the move. Output:
`~/.temperance_engine/session-maps/<portfolio>/<repository>/map.json`, mode
`0600`. Never git-tracked, never synced — inherently machine-specific.

For Claude Code specifically, a reversible symlink (default-on; disable with
`--no-relink`) is created so the tool continues its old session history at
the new path, gated never-clobber: only when the old session folder exists
and the new one does not.

Independently re-runnable — run once right after `apply`, and again later as
new sessions accumulate at the new path. Full design:
[`docs/superpowers/specs/2026-08-05-vault-session-map-design.md`](superpowers/specs/2026-08-05-vault-session-map-design.md).
```

- [ ] **Step 3: Run the full scoped relocation suite**

Run: `bun test package/relocation/ && bun test tests/vault-project-relocation.test.ts`
Expected: PASS, all tests across every relocation file including the 12 new/modified files from this plan.

- [ ] **Step 4: Verify no real mutation occurred**

Run these read-only checks and confirm the outputs show no change to real machine state:

```bash
ls ~/.temperance_engine/session-maps 2>&1   # expected: "No such file or directory" — nothing was ever run against real paths, only fixtures
find ~/.claude/projects -maxdepth 1 -type l 2>/dev/null   # expected: no new symlinks — attemptClaudeCodeRelink was only ever called against temp fixture dirs in tests
```

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-all.sh docs/vault-project-relocation.md
git commit -m "docs(relocation): wire session-map into verify-all.sh and document the subcommand"
```

---

## Self-Review

**Spec coverage:** Design §5 (per-tool findings) → Tasks 1–6 (one matcher per row of the table). §6 (data model) → Task 1 (types) + Task 7 (assembly, with the precedence rule the design's prose implied but its JSON schema didn't spell out — made explicit here rather than left ambiguous). §7 (architecture, hardcoded paths, `RegistryEntryRecord.oldPath` reuse) → Task 10. §8 (active relink, never-clobber, one call site) → Task 8 + Task 11's guard. §9 (CLI surface, portfolio/repository/stableId resolution) → Task 10. §10 (error handling) → every matcher task's `error`-path test. §11 (testing) → Tasks 1–9's fixture-only tests + Task 11's guard extension + Task 10's CLI argument-validation tests. §12 item 1 (encoding rules) → resolved empirically before Task 1 was written, folded into Task 1's doc comment and test fixtures. §12 item 3 (Craft Agent) → Task 6. §13 (relationship to existing system) → Task 10's reuse of `registryEntryPath`/`inferPortfolio`.

**Placeholder scan:** none found — Task 10's output-path and import claims were verified directly against the real file (`scripts/vault-project-relocation.ts`'s actual import block and the guard file's actual `PRODUCTION_RELOCATION_FILES` array) rather than assumed, and corrected in-place before this review pass.

**Type consistency:** `ToolMatchResult`, `SessionMapEntry`, `SessionMapRecord`, `ClaudeCodeRelinkAction`, `BuildSessionMapInput` are defined once in Task 1 and referenced identically (same field names, same casing) in every later task. `matched: boolean | null` is used consistently as a three-state field per Design §6 across every matcher (`true`/`false`/`null`, never a bare boolean default). Function names match exactly between "Produces" blocks and later "Consumes" blocks: `matchClaudeCode`, `matchOpenCode`, `matchCopilot`, `matchCodex`, `matchKimi`, `matchCraftAgent`, `buildSessionMap`, `attemptClaudeCodeRelink`, `applyClaudeCodeRelink`, `writeSessionMap` — no renames across tasks.
