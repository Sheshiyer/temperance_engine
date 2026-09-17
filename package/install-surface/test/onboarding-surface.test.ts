import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ONBOARDING_CATALOG_SCHEMA, ONBOARDING_PROFILE_SCHEMA, type OnboardingPlanV1 } from "../src/onboarding/contracts.ts";
import { createOnboardingReceipt } from "../src/onboarding/receipt.ts";
import { createOnboardingViewModel, renderOnboardingText } from "../src/onboarding/presentation.ts";
import { canConfirmOnboardingPlan } from "../src/onboarding/tui.ts";
import { parseOnboardingArgs } from "../src/onboarding/cli-args.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const plan: OnboardingPlanV1 = {
  schema: "temperance.onboarding.plan.v1",
  version: { major: 1, minor: 0 },
  profile_id: "portable",
  generated_at: "2026-01-01T00:00:00.000Z",
  dry_run: true,
  operating_mode: "blocked",
  install_order: ["ready"],
  plan_digest: `sha256:${"a".repeat(64)}`,
  modules: [
    { id: "ready", title: "Ready", requested: true, status: "eligible", holds: [], guided_installs: [], advisories: [] },
    {
      id: "blocked",
      title: "Blocked",
      requested: true,
      status: "blocked",
      holds: [{ reason_code: "APPLICATION_MISSING", capability_id: "app", message: "app missing", remediation: ["Install it."], evidence: [] }],
      guided_installs: [{ id: "install", label: "Install app", kind: "open-url", url: "https://example.invalid/install" }],
      advisories: [],
    },
  ],
};

describe("onboarding presentation", () => {
  test("renders status, holds, and guided repair from one view model", () => {
    const view = createOnboardingViewModel(plan);
    expect(view.summary).toContain("1 eligible");
    expect(view.pages.map((page) => page.id)).toEqual(["overview", "modules", "projects", "integrations", "review"]);
    expect(view.confirmation).toBe("required");
    expect(view.rows.find((row) => row.id === "blocked")?.blocked_reasons).toEqual(["APPLICATION_MISSING"]);
    const text = renderOnboardingText(plan);
    expect(text).toContain("APPLICATION_MISSING");
    expect(text).toContain("Install app");
    expect(text).toContain("READ-ONLY PLAN");
  });

  test("receipt stores only secret reference identifiers and no profile values", () => {
    const receipt = createOnboardingReceipt(plan, {
      schema: ONBOARDING_PROFILE_SCHEMA,
      version: { major: 1, minor: 0 },
      id: "portable",
      variables: { PRIVATE_ROOT: "/example/private" },
      secret_references: { PROVIDER_KEY: { store: "macos-keychain", service: "private.service", account: "private-account" } },
      preselected_modules: [],
      routing_aliases: [],
      project_enrollments: [],
    });
    const serialized = JSON.stringify(receipt);
    expect(receipt.secret_reference_ids).toEqual(["PROVIDER_KEY"]);
    expect(serialized).not.toContain("/example/private");
    expect(serialized).not.toContain("private.service");
    expect(serialized).not.toContain("private-account");
    expect(serialized).not.toContain("x-9r-cli-token");
  });

  test("refuses confirmation for blocked plans and labels an absent Madara volume", () => {
    const withMadara: OnboardingPlanV1 = {
      ...plan,
      operating_mode: "read-only-degraded",
      modules: [...plan.modules, {
        id: "storage.madara",
        title: "Madara",
        requested: true,
        status: "blocked",
        holds: [{ reason_code: "MOUNT_ABSENT", capability_id: "madara-volume", message: "absent", remediation: ["Mount it."], evidence: [] }],
        guided_installs: [],
        advisories: [],
      }],
    };
    expect(canConfirmOnboardingPlan(plan)).toBe(false);
    expect(canConfirmOnboardingPlan(withMadara)).toBe(true);
    const overview = createOnboardingViewModel(withMadara).pages.find(({ id }) => id === "overview");
    expect(overview?.rows.find(({ id }) => id === "mount")?.title).toBe("Madara: absent · read-only degraded");
  });

  test("shows discovered projects as pending rather than enrolled", () => {
    const withCandidate: OnboardingPlanV1 = {
      ...plan,
      project_candidates: [{
        schema: "temperance.project-capsule.v1", version: { major: 1, minor: 0 }, id: "portfolio.cambium",
        repository_identity: "github.com/example/cambium", root_variable: "PROJECT_ROOT", relative_path: "cambium",
        access: "read-only", approved: false, discovery_source: "portfolio", display_name: "Cambium", path_present: true,
      }],
    };
    const projects = createOnboardingViewModel(withCandidate).pages.find(({ id }) => id === "projects");
    expect(projects?.rows).toEqual([expect.objectContaining({
      id: "portfolio.cambium", status: "not-selected", title: "Cambium · pending approval",
    })]);
  });

  test("review displays the exact bound 9router configuration input", () => {
    const withConfiguration: OnboardingPlanV1 = {
      ...plan,
      configuration_inputs: [{
        id: "9router-guided-setup",
        digest: `sha256:${"b".repeat(64)}`,
        details: ["provider primary: anthropic · Primary", "combo noesis-build: anthropic/claude-build"],
      }],
    };
    const review = createOnboardingViewModel(withConfiguration).pages.find(({ id }) => id === "review");
    expect(review?.rows.map(({ id }) => id)).toEqual([
      "operation-plan",
      "configuration.9router-guided-setup",
      "configuration.9router-guided-setup.detail.1",
      "configuration.9router-guided-setup.detail.2",
    ]);
    expect(review?.rows[1]?.guidance).toContain(`digest: sha256:${"b".repeat(64)}`);
    expect(review?.rows[3]?.guidance).toEqual(["combo noesis-build: anthropic/claude-build"]);
    expect(renderOnboardingText(withConfiguration)).toContain("CONFIGURATION 9router-guided-setup");
  });
});

test("CLI onboarding is JSON-capable and read-only by default", async () => {
  const root = mkdtempSync(join(tmpdir(), "temperance-onboard-cli-"));
  roots.push(root);
  const catalogPath = join(root, "catalog.json");
  const profilePath = join(root, "profile.json");
  writeFileSync(catalogPath, JSON.stringify({
    schema: ONBOARDING_CATALOG_SCHEMA,
    version: { major: 1, minor: 0 },
    modules: [{ id: "ready", title: "Ready", summary: "ready", preselection: "selected", depends_on: [], requires: [], guided_installs: [] }],
  }));
  writeFileSync(profilePath, JSON.stringify({
    schema: ONBOARDING_PROFILE_SCHEMA,
    version: { major: 1, minor: 0 },
    id: "portable-cli",
    variables: {}, secret_references: {}, preselected_modules: [], routing_aliases: [], project_enrollments: [],
  }));
  const packageRoot = resolve(import.meta.dir, "..");
  const child = Bun.spawn(["bun", "run", "src/cli.ts", "onboard", "--catalog", catalogPath, "--profile-file", profilePath, "--json"], {
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  const output = JSON.parse(stdout);
  expect(output.dry_run).toBe(true);
  expect(output.install_order).toEqual(["ready"]);
}, 15_000);

test("CLI onboarding starts with the portable core when no personal profile is selected", async () => {
  const packageRoot = resolve(import.meta.dir, "..");
  const child = Bun.spawn(["bun", "run", "src/cli.ts", "onboard", "--json"], {
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  const output = JSON.parse(stdout);
  expect(output.profile_id).toBe("temperance-portable-core");
  expect(output.modules.map(({ id }: { id: string }) => id)).toEqual(["provider.9router"]);
  expect(stdout).not.toContain("magenarayan");
}, 15_000);

test("CLI composes a portable host profile with a private host binding", async () => {
  const root = mkdtempSync(join(tmpdir(), "temperance-onboard-compose-cli-"));
  roots.push(root);
  const hostProfilePath = join(root, "host-profile.json");
  const hostBindingPath = join(root, "host-binding.json");
  writeFileSync(hostProfilePath, JSON.stringify({
    schema: "temperance.host-profile.v1",
    version: { major: 1, minor: 0 },
    id: "composed-cli",
    variables: [{ name: "NINE_ROUTER_DATA_DIR", kind: "absolute-path", required: true }],
    secret_references: [],
    preselected_modules: ["provider.9router"],
    required_routing_aliases: [],
  }));
  writeFileSync(hostBindingPath, JSON.stringify({
    schema: "temperance.host-binding.v1",
    version: { major: 1, minor: 0 },
    profile_id: "composed-cli",
    variables: { NINE_ROUTER_DATA_DIR: join(root, "9router") },
    secret_references: {},
    routing_aliases: [],
    volume_bindings: [],
  }));
  const packageRoot = resolve(import.meta.dir, "..");
  const child = Bun.spawn([
    "bun", "run", "src/cli.ts", "onboard",
    "--host-profile", hostProfilePath,
    "--host-binding", hostBindingPath,
    "--json",
  ], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  const output = JSON.parse(stdout);
  expect(output.profile_id).toBe("composed-cli");
  expect(output.modules.map(({ id }: { id: string }) => id)).toEqual(["provider.9router"]);
  expect(output.dry_run).toBe(true);
}, 15_000);

test("CLI repair mode requires TUI review, private bindings, exact scope, desired state, and receipts", () => {
  expect(parseOnboardingArgs([
    "--tui",
    "--repair",
    "--host-profile", "/private/host-profile.json",
    "--host-binding", "/private/host-binding.json",
    "--router-setup", "/private/9router-setup.json",
    "--receipt-dir", "/private/receipts",
    "--select", "provider.9router",
  ])).toMatchObject({ apply: true, tui: true, selections: new Set(["provider.9router"]) });
  expect(() => parseOnboardingArgs([
    "--repair",
    "--host-profile", "/private/host-profile.json",
    "--host-binding", "/private/host-binding.json",
    "--router-setup", "/private/9router-setup.json",
    "--receipt-dir", "/private/receipts",
    "--select", "provider.9router",
  ])).toThrow("ONBOARDING_ARGUMENT_INVALID");
  expect(() => parseOnboardingArgs([
    "--tui",
    "--repair",
    "--host-profile", "/private/host-profile.json",
    "--host-binding", "/private/host-binding.json",
    "--router-setup", "/private/9router-setup.json",
    "--receipt-dir", "/private/receipts",
    "--select", "provider.9router,storage.madara",
  ])).toThrow("ONBOARDING_ARGUMENT_INVALID");
  expect(() => parseOnboardingArgs(["--tui", "--router-setup", "--receipt-dir", "/private/receipts"])).toThrow("ONBOARDING_ARGUMENT_INVALID");
});

test("built CLI starts without Madara and preserves eligible local modules", async () => {
  const packageRoot = resolve(import.meta.dir, "..");
  const buildRoot = mkdtempSync(join(packageRoot, ".built-cli-smoke-"));
  const fixtureRoot = mkdtempSync(join(tmpdir(), "temperance-no-madara-cli-"));
  roots.push(buildRoot, fixtureRoot);

  const build = Bun.spawn([
    "bun", "build", "src/cli.ts", "--target=bun", `--outdir=${buildRoot}`, "--packages=external",
  ], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
  const [buildCode, _buildStdout, buildStderr] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
  ]);
  expect(buildCode, buildStderr).toBe(0);

  const catalogPath = join(fixtureRoot, "catalog.json");
  const hostProfilePath = join(fixtureRoot, "host-profile.json");
  const hostBindingPath = join(fixtureRoot, "host-binding.json");
  const absentMount = join(fixtureRoot, "not-mounted");
  writeFileSync(catalogPath, JSON.stringify({
    schema: ONBOARDING_CATALOG_SCHEMA,
    version: { major: 1, minor: 0 },
    modules: [
      { id: "local-core", title: "Local core", summary: "offline-safe", preselection: "selected", depends_on: [], requires: [], guided_installs: [] },
      {
        id: "storage.madara", title: "Madara", summary: "external projects", preselection: "selected", depends_on: [],
        requires: [{ id: "madara-volume", kind: "mount", mount_path_variable: "MADARA_ROOT", expected_uuid_variable: "MADARA_UUID" }],
        guided_installs: [],
      },
    ],
  }));
  writeFileSync(hostProfilePath, JSON.stringify({
    schema: "temperance.host-profile.v1",
    version: { major: 1, minor: 0 },
    id: "absent-madara-smoke",
    variables: [
      { name: "MADARA_ROOT", kind: "absolute-path", required: false },
      { name: "MADARA_UUID", kind: "volume-uuid", required: false },
    ],
    secret_references: [],
    preselected_modules: ["local-core", "storage.madara"],
    required_routing_aliases: [],
  }));
  writeFileSync(hostBindingPath, JSON.stringify({
    schema: "temperance.host-binding.v1",
    version: { major: 1, minor: 0 },
    profile_id: "absent-madara-smoke",
    variables: { MADARA_ROOT: absentMount },
    secret_references: {},
    routing_aliases: [],
    volume_bindings: [{
      id: "madara", mount_path_variable: "MADARA_ROOT", volume_uuid_variable: "MADARA_UUID", volume_uuid: "ABSENT-0001",
    }],
  }));

  const child = Bun.spawn([
    "bun", join(buildRoot, "cli.js"), "onboard",
    "--catalog", catalogPath,
    "--host-profile", hostProfilePath,
    "--host-binding", hostBindingPath,
    "--json",
  ], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  const output = JSON.parse(stdout);
  expect(output.operating_mode).toBe("read-only-degraded");
  expect(output.modules.find(({ id }: { id: string }) => id === "local-core")).toMatchObject({ status: "eligible" });
  expect(output.modules.find(({ id }: { id: string }) => id === "storage.madara")).toMatchObject({
    status: "blocked",
    holds: [expect.objectContaining({ reason_code: "MOUNT_ABSENT" })],
  });
}, 30_000);
