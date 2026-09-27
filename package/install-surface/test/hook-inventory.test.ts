import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createPlan } from "../src/lifecycle/planner.ts";
import { validateFragment } from "../src/schema.ts";
import type { CompileResult } from "../src/compile.ts";
import type { SurfaceRecord } from "../src/types.ts";

const repository = resolve(import.meta.dir, "../../..");
const fragments = join(repository, "package/install-surface/fragments");
const hooks = JSON.parse(readFileSync(join(fragments, "hooks.json"), "utf8")) as { records: SurfaceRecord[] };
const records: SurfaceRecord[] = readdirSync(fragments).filter(name => name.endsWith(".json")).flatMap(name =>
  JSON.parse(readFileSync(join(fragments, name), "utf8")).records,
);
// Planning-only fixture: this is not an install lock or a reviewed source receipt.
const compiled: CompileResult = {
  lockObject: {
    schema: "temperance.install-surface.lock.v1",
    schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1",
    version: { major: 1, minor: 0 },
    records,
  },
  canonicalBytes: "{}",
  digest: `sha256:${"0".repeat(64)}`,
  semanticIds: records.map(record => record.id),
};
const temporaryRoots: string[] = [];
afterEach(() => temporaryRoots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function hook(id: string) {
  const record = hooks.records.find(value => value.id === id);
  if (!record || record.class !== "COPY") throw new Error(`COPY hook not declared: ${id}`);
  return record;
}

describe("portable hook companion inventory", () => {
  test("hook fragment validates and every local import has a same-client declared dependency", () => {
    expect(validateFragment(hooks)).toBe(true);
    for (const record of hooks.records) {
      if (record.class !== "COPY") continue;
      const source = readFileSync(join(repository, record.source), "utf8");
      const imports = [...source.matchAll(/from\s+["'](\.\/[A-Za-z0-9.-]+\.ts)["']/g)].map(match => match[1]);
      for (const imported of imports) {
        const target = join(dirname(record.destination.relative_path), imported);
        const companion = hooks.records.find(value => value.destination.root_token === record.destination.root_token && value.destination.relative_path === target);
        expect(companion).toBeDefined();
        expect(record.depends_on).toContain(companion!.id);
      }
    }
  });

  test("Claude companions reuse public source while retaining existing default-platform eligibility", () => {
    for (const suffix of ["gsd-command", "manifest-mode-commit", "temperance-rail-announce"]) {
      const claude = hook(`hooks.claude.${suffix}`);
      const codex = hook(`hooks.codex.${suffix}`);
      expect(claude.source).toBe(codex.source);
      expect(statSync(join(repository, claude.source)).isFile()).toBe(true);
      expect(claude.destination.root_token).toBe("CLAUDE_CONFIG_DIR");
      expect(claude.destination.relative_path).toBe(codex.destination.relative_path);
      expect(claude.destination.ownership.kind).toBe("exclusive-path");
      expect(claude.eligibility).toEqual(codex.eligibility);
      expect(claude.eligibility.profiles).toEqual(["default"]);
      expect(claude.eligibility.platforms).toEqual(["darwin", "linux"]);
      expect(claude.verification.method).toBe("sha256");
      expect(claude.rollback.policy).toBe("restore-backup");
    }
  });

  test("scoped update selects only the requested client, its companions, and shared router closure", () => {
    for (const client of ["claude", "codex"]) {
      const prompt = `hooks.${client}.prompt-processing`;
      const plan = createPlan({ verb: "update", profileResult: compiled, profile: "default", platform: "darwin", onlyIds: new Set([prompt]) });
      expect(plan.scope?.record_ids).toEqual([
        `hooks.${client}.gsd-command`, `hooks.${client}.manifest-mode-commit`, prompt,
        `hooks.${client}.temperance-rail-announce`, "router.governed-runtime", "router.gsd-backup-helper",
      ].sort());
      const order = plan.steps.map(step => step.record_id);
      expect(order.indexOf("router.governed-runtime")).toBeLessThan(order.indexOf(`hooks.${client}.temperance-rail-announce`));
      expect(order.indexOf(`hooks.${client}.temperance-rail-announce`)).toBeLessThan(order.indexOf(prompt));
      expect(order.indexOf(`hooks.${client}.manifest-mode-commit`)).toBeLessThan(order.indexOf(`hooks.${client}.gsd-command`));
      expect(order.some(id => id.includes(client === "claude" ? ".codex." : ".claude."))).toBe(false);
    }
  });

  test("a dual-client header update has ten COPY records and no unrelated runtime mutations", () => {
    const plan = createPlan({ verb: "update", profileResult: compiled, profile: "default", platform: "darwin", onlyIds: new Set(["hooks.claude.prompt-processing", "hooks.codex.prompt-processing"]) });
    expect(plan.scope?.record_ids).toHaveLength(10);
    expect(plan.steps.every(step => records.find(record => record.id === step.record_id)?.class === "COPY")).toBe(true);
    expect(plan.scope?.record_ids).not.toContain("hooks.codex.session-start");
    expect(plan.scope?.record_ids).not.toContain("configuration.codex-managed-block");
  });

  test("both installed prompt adapters bundle with exactly their declared local companions", async () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-hook-inventory-"));
    temporaryRoots.push(root);
    for (const client of ["claude", "codex"]) {
      const clientRoot = join(root, `.${client}`);
      const selected = hooks.records.filter(record => record.id.startsWith(`hooks.${client}.`));
      for (const record of selected) {
        if (record.class !== "COPY") continue;
        const destination = join(clientRoot, record.destination.relative_path);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(join(repository, record.source), destination);
      }
      const result = await Bun.build({ entrypoints: [join(clientRoot, "hooks/PromptProcessing.hook.ts")], target: "bun" });
      expect(result.logs.filter(message => message.level === "error")).toEqual([]);
      expect(result.success).toBe(true);
    }
  });

  test("real prompt stdin prefers managed kosha headers without Bridge, while preserving override and archive fallback", () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-prompt-routing-"));
    temporaryRoots.push(root);
    for (const client of ["claude", "codex"]) {
      for (const mode of ["managed", "override", "archive", "default-state"]) {
        // Child-only home/state/archive fixtures prevent telemetry or state writes to the host.
        const home = join(root, client, mode, "home");
        const state = join(home, mode === "default-state" ? ".temperance" : "state");
        const archive = join(home, "archive");
        const archiveRouter = join(archive, "package/router");
        const managedRouter = join(state, "router");
        const overrideRouter = join(home, "override-router");
        const enrichment = join(home, "enrichment");
        for (const directory of [home, archiveRouter, overrideRouter, enrichment]) mkdirSync(directory, { recursive: true });
        writeFileSync(join(archiveRouter, "rail-announce.ts"), 'export const buildCodexRail = () => "STALE_ARCHIVE_MARKER";');
        writeFileSync(join(overrideRouter, "rail-announce.ts"), 'export const buildCodexRail = () => "EXPLICIT_OVERRIDE_MARKER";');
        writeFileSync(join(enrichment, "index.ts"), 'export const enrich = () => `MODE: ALGORITHM | TIER: E3\nselected-router=${process.env.TEMPERANCE_ROUTER_DIR}\nselected-resolver=${process.env.TEMPERANCE_OMNIROUTE_PORTFOLIO_RESOLVER}`;');
        if (mode !== "archive") {
          mkdirSync(managedRouter, { recursive: true });
          for (const name of ["rail-announce.ts", "phase-projection.v4.ts", "task-classification.ts"]) copyFileSync(join(repository, "package/router", name), join(managedRouter, name));
        }
        const clientRoot = join(home, `.${client}`);
        for (const record of hooks.records.filter(value => value.id.startsWith(`hooks.${client}.`))) {
          if (record.class !== "COPY") continue;
          const destination = join(clientRoot, record.destination.relative_path);
          mkdirSync(dirname(destination), { recursive: true });
          copyFileSync(join(repository, record.source), destination);
        }
        const selected = mode === "override" ? overrideRouter : mode === "archive" ? archiveRouter : managedRouter;
        const child = Bun.spawnSync([process.execPath, "--no-env-file", "--config=/dev/null", join(clientRoot, "hooks/PromptProcessing.hook.ts")], {
          cwd: home,
          env: {
            HOME: home,
            PATH: process.env.PATH,
            TEMPERANCE_STATE: mode === "default-state" ? "" : state,
            TEMPERANCE_ENGINE_ROOT: archive,
            TEMPERANCE_ENRICH_DIR: enrichment,
            TEMPERANCE_ROUTER_DIR: mode === "override" ? overrideRouter : "",
            TEMPERANCE_PHASE_COMBO_MAP: join(home, "absent-overlay.json"),
          },
          stdin: Buffer.from(JSON.stringify({ prompt: "Create an implementation plan", session_id: "fixture-only" })),
          stdout: "pipe", stderr: "pipe",
        });
        expect(child.exitCode).toBe(0);
        expect(child.stderr.toString()).toBe("");
        const context = JSON.parse(child.stdout.toString()).hookSpecificOutput.additionalContext;
        expect(context).toContain(`selected-router=${selected}`);
        expect(context).toContain(`selected-resolver=${join(selected, "omniroute-portfolios.ts")}`);
        if (mode === "managed" || mode === "default-state") {
          expect(context).toContain("CITRINITAS · PLAN · 3/7 · VIJNANAMAYA");
          expect(context).not.toContain("STALE_ARCHIVE_MARKER");
          expect(context).toContain("UNVERIFIED");
        } else {
          expect(context).toContain(mode === "override" ? "EXPLICIT_OVERRIDE_MARKER" : "STALE_ARCHIVE_MARKER");
        }
      }
    }
  });
});
