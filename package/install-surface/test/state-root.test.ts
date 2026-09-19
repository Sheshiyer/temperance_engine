import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { canonical } from "../src/canonical-json.ts";
import type { DoctorContext, DoctorSection } from "../src/doctor/model.ts";
import { runDoctor, runDoctorV2 } from "../src/doctor/orchestrator.ts";
import { resolveRuntimeStateRoot } from "../src/state-root.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("portable runtime state root", () => {
  const homeDirectory = join(tmpdir(), "portable-user");

  test("explicit state root wins over the environment", () => {
    expect(resolveRuntimeStateRoot({
      stateRoot: join(homeDirectory, "explicit"),
      environment: { TEMPERANCE_STATE: join(homeDirectory, "environment") },
      homeDirectory,
    })).toBe(join(homeDirectory, "explicit"));
  });

  test("environment root wins over the portable default", () => {
    expect(resolveRuntimeStateRoot({
      environment: { TEMPERANCE_STATE: join(homeDirectory, "environment") },
      homeDirectory,
    })).toBe(join(homeDirectory, "environment"));
  });

  test.each([undefined, ""])("unset or empty environment resolves to .temperance (%s)", (value) => {
    expect(resolveRuntimeStateRoot({ environment: { TEMPERANCE_STATE: value }, homeDirectory }))
      .toBe(join(homeDirectory, ".temperance"));
  });
});

for (const version of [1, 2] as const) {
  describe(`doctor v${version} uses the lifecycle state root`, () => {
    for (const selection of ["explicit", "environment", "default"] as const) {
      test(selection, async () => {
        const repositoryRoot = mkdtempSync(join(tmpdir(), "doctor-state-root-"));
        roots.push(repositoryRoot);
        const lockDirectory = join(repositoryRoot, "package/install-surface");
        mkdirSync(lockDirectory, { recursive: true });
        writeFileSync(join(lockDirectory, "install-surface-manifest.lock.json"), canonical({
          schema: "temperance.install-surface.lock.v1",
          schema_uri: "https://thoughtseed.space/schemas/temperance/install-surface/lock/v1",
          version: { major: 1, minor: 0 },
          records: [],
        }));

        const previous = { TEMPERANCE_STATE: process.env.TEMPERANCE_STATE, CODEX_HOME: process.env.CODEX_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
        if (selection === "default") delete process.env.TEMPERANCE_STATE;
        else process.env.TEMPERANCE_STATE = join(repositoryRoot, "environment");
        process.env.CODEX_HOME = join(repositoryRoot, "codex-override");
        process.env.CLAUDE_CONFIG_DIR = join(repositoryRoot, "claude-override");

        try {
          const stateRoot = selection === "explicit" ? join(repositoryRoot, "explicit") : undefined;
          const expected = resolveRuntimeStateRoot({ stateRoot, environment: process.env, homeDirectory: homedir() });
          let observed: Pick<DoctorContext, "stateRoot" | "rootBindings"> | undefined;
          const install = async (context: DoctorContext): Promise<DoctorSection> => {
            observed = { stateRoot: context.stateRoot, rootBindings: context.rootBindings };
            return { id: "install", condition: "PASS", checks: [] };
          };
          const options = { repositoryRoot, stateRoot, sections: ["install" as const], runners: { install } };
          const report = version === 1
            ? await runDoctor(options)
            : await runDoctorV2({ ...options, inventory: { digest: `sha256:${"0".repeat(64)}` } });

          expect(report.trustworthy).toBe(true);
          expect(report.overall_condition).toBe("PASS");
          expect(observed?.stateRoot).toBe(expected);
          expect(observed?.rootBindings.TEMPERANCE_STATE).toBe(expected);
          expect(observed?.rootBindings.CODEX_HOME).toBe(process.env.CODEX_HOME);
          expect(observed?.rootBindings.CLAUDE_CONFIG_DIR).toBe(process.env.CLAUDE_CONFIG_DIR);
          if (selection === "default") expect(expected).toBe(join(homedir(), ".temperance"));
        } finally {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      });
    }
  });
}
