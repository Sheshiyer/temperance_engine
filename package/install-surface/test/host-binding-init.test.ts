import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseHostBindingInitArgs } from "../src/onboarding/host-binding-init-cli-args.ts";
import { createHostBinding, writePrivateHostBinding } from "../src/onboarding/host-binding-init.ts";
import type { HostProfileV1 } from "../src/onboarding/public-contracts.ts";

// Binding values use fictional roots; only disposable output directories exist.
const fixtureProjects = "/fixture/volumes/projects";
const fixturePrivateProjects = "/fixture/volumes/private-projects";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const profile: HostProfileV1 = {
  schema: "temperance.host-profile.v1",
  version: { major: 1, minor: 0 },
  id: "binding-init-test",
  variables: [
    { name: "PROJECT_ROOT", kind: "absolute-path", required: true },
    { name: "ROUTER_URL", kind: "url", required: true },
    { name: "PROJECT_VOLUME_UUID", kind: "volume-uuid", required: false },
  ],
  secret_references: [{ name: "GATEWAY_KEY", required: true }],
  preselected_modules: [],
  required_routing_aliases: ["noesis-plan"],
};

describe("private host binding initializer", () => {
  test("parses repeated reference-only inputs without a plaintext-secret option", () => {
    expect(parseHostBindingInitArgs([
      "--host-profile", "/profiles/noesis.json",
      "--output", "/private/host-binding.json",
      "--set", "PROJECT_ROOT", fixtureProjects,
      "--secret-reference", "GATEWAY_KEY", "temperance.gateway", "default",
      "--alias", "noesis-plan", "planning-seat",
      "--volume", "projects", "PROJECT_ROOT", "PROJECT_VOLUME_UUID", "TEST-UUID",
    ])).toEqual({
      hostProfilePath: "/profiles/noesis.json",
      outputPath: "/private/host-binding.json",
      variables: { PROJECT_ROOT: fixtureProjects },
      secretReferences: { GATEWAY_KEY: { store: "macos-keychain", service: "temperance.gateway", account: "default" } },
      routingAliases: [{ alias: "noesis-plan", combo: "planning-seat" }],
      volumeBindings: [{ id: "projects", mount_path_variable: "PROJECT_ROOT", volume_uuid_variable: "PROJECT_VOLUME_UUID", volume_uuid: "TEST-UUID" }],
    });
    expect(() => parseHostBindingInitArgs([
      "--host-profile", "/profiles/noesis.json", "--output", "/private/a.json",
      "--set", "PROJECT_ROOT", "/one", "--set", "PROJECT_ROOT", "/two",
    ])).toThrow("HOST_BINDING_INIT_ARGUMENT_DUPLICATE");
    expect(() => parseHostBindingInitArgs(["--plaintext-secret", "value"])).toThrow("HOST_BINDING_INIT_ARGUMENT_INVALID");
  });

  test("binds the exact observed host and writes one owner-only file", () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-host-binding-init-"));
    roots.push(root);
    chmodSync(root, 0o700);
    const binding = createHostBinding(profile, {
      variables: { PROJECT_ROOT: fixtureProjects, ROUTER_URL: "http://127.0.0.1:20128" },
      secretReferences: { GATEWAY_KEY: { store: "macos-keychain", service: "temperance.gateway", account: "default" } },
      routingAliases: [{ alias: "noesis-plan", combo: "planning-seat" }],
      volumeBindings: [{ id: "projects", mount_path_variable: "PROJECT_ROOT", volume_uuid_variable: "PROJECT_VOLUME_UUID", volume_uuid: "TEST-UUID" }],
    }, {
      platform: "darwin", hardware_model: "Mac16,11", chip_model: "Apple M4", architecture: "arm64", user_id: 501,
    });
    expect(binding.host_identity).toEqual({
      platform: "darwin", hardware_model: "Mac16,11", chip_model: "Apple M4", architecture: "arm64", user_id: 501,
    });
    expect(binding.variables).not.toHaveProperty("PROJECT_VOLUME_UUID");
    const output = join(root, "binding.json");
    expect(writePrivateHostBinding(output, binding)).toBe(output);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(binding);
    expect(() => writePrivateHostBinding(output, binding)).toThrow("HOST_BINDING_INIT_OUTPUT_EXISTS");
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(binding);
  });

  test("fails closed when exact target-host identity is unavailable", () => {
    expect(() => createHostBinding(profile, {
      variables: {}, secretReferences: {}, routingAliases: [], volumeBindings: [],
    }, {
      platform: "linux", hardware_model: "unknown", chip_model: "unknown", architecture: "arm64", user_id: 1000,
    })).toThrow("HOST_BINDING_INIT_IDENTITY_UNAVAILABLE");
  });

  test.skipIf(process.platform !== "darwin")("CLI uses synthetic host values and preserves exclusive private output", async () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-host-binding-synthetic-cli-"));
    roots.push(root);
    chmodSync(root, 0o700);
    const bin = join(root, "bin");
    mkdirSync(bin, { mode: 0o700 });
    const sysctl = join(bin, "sysctl");
    // This child-only PATH contains no real sysctl fallback. Shell builtins
    // return fictional values and record which observations the CLI requested.
    writeFileSync(sysctl, [
      "#!/bin/sh",
      '[ "$#" -eq 2 ] && [ "$1" = "-n" ] || exit 1',
      'printf "%s\\n" "$2" >> "$0.calls"',
      'case "$2" in',
      '  hw.model) printf "%s\\n" "FixtureMac1,1" ;;',
      '  machdep.cpu.brand_string) printf "%s\\n" "Fixture Chip" ;;',
      '  *) exit 1 ;;',
      'esac',
      "",
    ].join("\n"), { mode: 0o700 });
    const profilePath = join(root, "profile.json");
    const outputPath = join(root, "binding.json");
    writeFileSync(profilePath, JSON.stringify({
      schema: "temperance.host-profile.v1", version: { major: 1, minor: 0 }, id: "binding-cli-test",
      variables: [{ name: "PROJECT_ROOT", kind: "absolute-path", required: true }],
      secret_references: [], preselected_modules: [], required_routing_aliases: [],
    }));
    const run = async () => {
      const child = Bun.spawn([
        process.execPath, "src/cli.ts", "host-binding-init",
        "--host-profile", profilePath, "--output", outputPath,
        "--set", "PROJECT_ROOT", fixturePrivateProjects,
      ], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, PATH: bin, TEMPERANCE_ALLOW_LIVE_INSPECTION: "0" },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    };
    const first = await run();
    expect(first.code, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      schema: "temperance.host-binding-init-receipt.v1", profile_id: "binding-cli-test",
      variable_names: ["PROJECT_ROOT"], output_created: true,
      host_identity: { hardware_model: "FixtureMac1,1", chip_model: "Fixture Chip" },
    });
    expect(readFileSync(`${sysctl}.calls`, "utf8")).toBe("hw.model\nmachdep.cpu.brand_string\n");
    expect(first.stdout).not.toContain(fixturePrivateProjects);
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
    const original = readFileSync(outputPath, "utf8");
    expect(JSON.parse(original).variables.PROJECT_ROOT).toBe(fixturePrivateProjects);
    const second = await run();
    expect(second.code).toBe(64);
    expect(second.stderr).toContain("HOST_BINDING_INIT_OUTPUT_EXISTS");
    expect(second.stdout).toBe("");
    expect(readFileSync(outputPath, "utf8")).toBe(original);
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  });

  test.skipIf(process.platform !== "darwin" || process.env.TEMPERANCE_ALLOW_LIVE_INSPECTION !== "1")(
    "CLI observes the current Mac without echoing private variable values (opt-in live inspection)", async () => {
    const root = mkdtempSync(join(tmpdir(), "temperance-host-binding-cli-"));
    roots.push(root);
    chmodSync(root, 0o700);
    const profilePath = join(root, "profile.json");
    const outputPath = join(root, "binding.json");
    writeFileSync(profilePath, JSON.stringify({
      schema: "temperance.host-profile.v1", version: { major: 1, minor: 0 }, id: "binding-cli-test",
      variables: [{ name: "PROJECT_ROOT", kind: "absolute-path", required: true }],
      secret_references: [], preselected_modules: [], required_routing_aliases: [],
    }));
    const child = Bun.spawn([
      process.execPath, "src/cli.ts", "host-binding-init",
      "--host-profile", profilePath,
      "--output", outputPath,
      "--set", "PROJECT_ROOT", fixturePrivateProjects,
    ], { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect(code, stderr).toBe(0);
    const receipt = JSON.parse(stdout);
    expect(receipt).toMatchObject({
      schema: "temperance.host-binding-init-receipt.v1",
      profile_id: "binding-cli-test",
      variable_names: ["PROJECT_ROOT"],
      output_created: true,
    });
    expect(receipt.host_identity.hardware_model).not.toBe("unknown");
    expect(stdout).not.toContain(fixturePrivateProjects);
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);
  });
});
