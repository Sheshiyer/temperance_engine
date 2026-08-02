import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
  OMNIROUTE_NATIVE_CLI_READINESS_SCHEMA,
  OMNIROUTE_NATIVE_CLI_EXPECTED_SHA256,
  OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT,
  OmniRouteNativeCliReadinessError,
  inspectOmniRouteNativeCliReadiness,
  writeOmniRouteNativeCliReadinessReceipt,
  type NativeCliExpectedDigestMap,
} from "./omniroute-native-cli-readiness";
import { parseOmniRouteNativeCliReadinessArguments } from "../../scripts/omniroute-native-cli-readiness";

const roots: string[] = [];
const NOW = new Date("2026-08-02T07:30:00.000Z");

function makeTemporaryRoot(prefix = "temperance-native-cli-"): string {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), prefix)));
  chmodSync(root, 0o700);
  roots.push(root);
  return root;
}

function writeSource(root: string, relativePath: string, content: string): void {
  mkdirSync(dirname(join(root, relativePath)), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, relativePath), content, { encoding: "utf8", mode: 0o600 });
}

function makePackageFixture(version = "3.8.48"): string {
  const root = makeTemporaryRoot();
  for (const contract of OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT) {
    const content =
      contract.id === "package-manifest"
        ? `${JSON.stringify({ name: "omniroute", version }, null, 2)}\n`
        : `// inert fixture for ${contract.id}\n${contract.markers.map(({ value }) => value).join("\n")}\n`;
    writeSource(root, contract.relativePath, content);
  }
  writeSource(root, "bin/omniroute.mjs", "#!/usr/bin/env node\n");
  return root;
}

function fixtureDigestMap(root: string): NativeCliExpectedDigestMap {
  return Object.fromEntries(
    OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.map(({ id, relativePath }) => [
      id,
      createHash("sha256").update(readFileSync(join(root, relativePath))).digest("hex"),
    ]),
  ) as NativeCliExpectedDigestMap;
}

function inspectFixture(root: string, expectedDigests = fixtureDigestMap(root)) {
  return inspectOmniRouteNativeCliReadiness({
    packageRoot: root,
    fixtureExpectedDigests: expectedDigests,
    now: () => NOW,
  });
}

function mutateMarker(root: string, relativePath: string, marker: string, replacement: string): void {
  const path = join(root, relativePath);
  const source = readFileSync(path, "utf8");
  expect(source.includes(marker)).toBe(true);
  writeFileSync(path, source.replace(marker, replacement), "utf8");
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("offline native CLI source contract", () => {
  test("verifies the exact allowlist, supported version, static markers, hashes, and nonclaims", () => {
    const root = makePackageFixture();
    const receipt = inspectFixture(root);

    expect(receipt.schema).toBe(OMNIROUTE_NATIVE_CLI_READINESS_SCHEMA);
    expect(receipt.createdAt).toBe(NOW.toISOString());
    expect(receipt.observedAt).toBe(NOW.toISOString());
    expect(receipt.validity).toBe("instant-observation");
    expect(receipt.cacheable).toBe(false);
    expect(receipt.replayAuthorized).toBe(false);
    expect(receipt.classification).toBe("contract_verified");
    expect(receipt.contractVerified).toBe(true);
    expect(receipt.digestPinSource).toBe("injected-hermetic-fixture");
    expect(receipt.observedPackage).toEqual({
      name: "omniroute",
      version: "3.8.48",
      nameMatches: true,
      versionMatches: true,
    });
    expect(receipt.sourceAllowlist).toEqual(
      OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.map(({ relativePath }) => relativePath),
    );
    expect(receipt.sources).toHaveLength(OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.length);
    expect(receipt.nonClaims.pinnedFileCount).toBe(OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.length);
    expect(Object.keys(OMNIROUTE_NATIVE_CLI_EXPECTED_SHA256)).toHaveLength(
      receipt.nonClaims.pinnedFileCount,
    );
    expect(
      receipt.sources.every(
        ({ sha256, expectedSha256, digestMatches }) =>
          /^[a-f0-9]{64}$/u.test(sha256 ?? "") &&
          /^[a-f0-9]{64}$/u.test(expectedSha256) &&
          digestMatches,
      ),
    ).toBe(true);
    expect(receipt.sources.every(({ relativePath }) => !relativePath.includes(root))).toBe(true);
    expect(Object.values(receipt.checks).every(Boolean)).toBe(true);
    expect(receipt.nonClaims).toEqual({
      integrityScope: "exact-reviewed-allowlist-file-digests",
      pinnedFileCount: 6,
      packageIntegrityComplete: false,
      entrypointResolutionPinned: false,
      loadedModuleGraphVerified: false,
      consumerPromotionUseAuthorized: false,
      transportBound: false,
      blockingCondition: "401 AUTH_001 unresolved",
      sameUidAncestorRaceEliminated: false,
      offlineInspectionOnly: true,
      networkAccessPerformed: false,
      socketAccessPerformed: false,
      installedCodeImported: false,
      installedCodeExecuted: false,
      tokenHelperImported: false,
      tokenHelperExecuted: false,
      credentialSourcesRead: false,
      authenticationEstablished: false,
      authorizationEstablished: false,
      semanticPreviewPerformed: false,
      semanticPreviewQualified: false,
      settingsMutationPerformed: false,
      settingsMutationAuthorized: false,
      providerPromotionAuthorized: false,
    });
  });

  test("pins all six reviewed OmniRoute 3.8.48 whole-file digests exactly", () => {
    const contractIds = OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.map(({ id }) => id).sort();
    const pinIds = Object.keys(OMNIROUTE_NATIVE_CLI_EXPECTED_SHA256).sort();
    expect(pinIds).toEqual(contractIds);
    expect(
      OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.map(({ relativePath }) => relativePath).sort(),
    ).toEqual(
      [
        "package.json",
        "bin/cli/commands/compression.mjs",
        "bin/cli/api.mjs",
        "bin/cli/utils/cliToken.mjs",
        "src/server/authz/policies/management.ts",
        "dist/docs/openapi.yaml",
      ].sort(),
    );
    expect(OMNIROUTE_NATIVE_CLI_EXPECTED_SHA256).toEqual({
      "package-manifest": "6f154e5c973158c95dcbb7211a5d2ec691c396948c71a30959a472e88adff626",
      "compression-command": "5ddf420c99aea6ea72859fae27effeec5efcfd105a345afbd3cf74a4c1a52aa8",
      "cli-api": "9584c48cb91d0dccfbd9ea86b71ffc082d27f92c2f09bfb7560c0cafb17b9033",
      "cli-token-helper": "7cccffbbf267ee1e1f9ebf67feab66de943980b66b9d4f12f55b575d50795360",
      "management-policy": "d0809be23364924113a46ecf91ace938d6cd7a305f583667ff46ab6061b9e2e1",
      openapi: "e9bdf16a6ea225b4e4cad5dcf7c1fc141a40ba168f3028593ad9ac4c75e76053",
    });
    for (const contract of OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT) {
      expect(contract.expectedSha256).toBe(OMNIROUTE_NATIVE_CLI_EXPECTED_SHA256[contract.id]);
    }
  });

  test("verifies the installed default only against reviewed digest pins", () => {
    const receipt = inspectOmniRouteNativeCliReadiness({ now: () => NOW });
    expect(receipt.classification).toBe("contract_verified");
    expect(receipt.digestPinSource).toBe("reviewed-omniroute-3.8.48");
    expect(receipt.observedPackage.version).toBe("3.8.48");
    expect(receipt.sources.every(({ digestMatches }) => digestMatches)).toBe(true);
    expect(
      receipt.sources.every(
        ({ id, expectedSha256 }) => expectedSha256 === OMNIROUTE_NATIVE_CLI_EXPECTED_SHA256[id],
      ),
    ).toBe(true);
  });

  test("fails every individual digest mismatch while all contract markers remain intact", () => {
    for (const contract of OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT) {
      const root = makePackageFixture();
      const expectedDigests = fixtureDigestMap(root);
      const path = join(root, contract.relativePath);
      if (contract.id === "package-manifest") {
        writeFileSync(path, '{\n  "name": "omniroute",\n  "version": "3.8.48"\n}\n\n', "utf8");
      } else {
        writeFileSync(path, `${readFileSync(path, "utf8")}\n// adjacent-reviewed-source-drift\n`, "utf8");
      }
      const receipt = inspectFixture(root, expectedDigests);
      const drifted = receipt.sources.find(({ id }) => id === contract.id);
      expect(receipt.classification).toBe("contract_unverified");
      expect(drifted?.digestMatches).toBe(false);
      expect(drifted?.markerOrderValid).toBe(true);
      expect(Object.values(drifted?.markerPresence ?? {}).every(Boolean)).toBe(true);
      expect(
        receipt.sources
          .filter(({ id }) => id !== contract.id)
          .every(({ digestMatches }) => digestMatches),
      ).toBe(true);
    }
  });

  test("rejects comment and string injection despite preserving every static marker", () => {
    const root = makePackageFixture();
    const expectedDigests = fixtureDigestMap(root);
    const path = join(root, "bin/cli/api.mjs");
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}\n// markers remain exactly once\nconst adjacent = "arbitrary injection";\n`,
      "utf8",
    );
    const receipt = inspectFixture(root, expectedDigests);
    const api = receipt.sources.find(({ id }) => id === "cli-api");
    expect(Object.values(api?.markerPresence ?? {}).every(Boolean)).toBe(true);
    expect(api?.markerOrderValid).toBe(true);
    expect(receipt.checks.cliApiInjectsExactCliTokenHeader).toBe(true);
    expect(api?.digestMatches).toBe(false);
    expect(receipt.classification).toBe("contract_unverified");
  });

  test("does not misrepresent unpinned entrypoint drift as complete package integrity", () => {
    const root = makePackageFixture();
    const expectedDigests = fixtureDigestMap(root);
    writeFileSync(join(root, "bin/omniroute.mjs"), "#!/usr/bin/env node\n// unpinned entrypoint drift\n");
    const receipt = inspectFixture(root, expectedDigests);
    expect(receipt.classification).toBe("contract_verified");
    expect(receipt.nonClaims).toMatchObject({
      pinnedFileCount: 6,
      packageIntegrityComplete: false,
      entrypointResolutionPinned: false,
      loadedModuleGraphVerified: false,
    });
    expect(receipt.sourceAllowlist).not.toContain("bin/omniroute.mjs");
  });

  test("fails closed when every individual contract marker is missing", () => {
    for (const contract of OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT) {
      for (const marker of contract.markers) {
        const root = makePackageFixture();
        mutateMarker(root, contract.relativePath, marker.value, "");
        const receipt = inspectFixture(root);
        expect(receipt.classification).toBe("contract_unverified");
        expect(receipt.sources.find(({ id }) => id === contract.id)?.markerPresence[marker.id]).toBe(false);
      }
    }
  });

  test("fails closed when every individual contract marker is mutated", () => {
    for (const contract of OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT) {
      for (const marker of contract.markers) {
        const root = makePackageFixture();
        mutateMarker(
          root,
          contract.relativePath,
          marker.value,
          `${marker.value.slice(0, -1)}${marker.value.endsWith("X") ? "Y" : "X"}`,
        );
        const receipt = inspectFixture(root);
        expect(receipt.classification).toBe("contract_unverified");
        expect(receipt.sources.find(({ id }) => id === contract.id)?.markerPresence[marker.id]).toBe(false);
      }
    }
  });

  test("holds version, package identity, missing file, non-file, and source symlink drift", () => {
    const versionRoot = makePackageFixture("3.8.49");
    expect(inspectFixture(versionRoot).observedPackage.versionMatches).toBe(false);

    const identityRoot = makePackageFixture();
    writeSource(identityRoot, "package.json", `${JSON.stringify({ name: "not-omniroute", version: "3.8.48" })}\n`);
    expect(inspectFixture(identityRoot).observedPackage.nameMatches).toBe(false);

    const missingRoot = makePackageFixture();
    const missingDigests = fixtureDigestMap(missingRoot);
    unlinkSync(join(missingRoot, "bin/cli/api.mjs"));
    expect(inspectFixture(missingRoot, missingDigests).classification).toBe("contract_unverified");

    const directoryRoot = makePackageFixture();
    const directoryDigests = fixtureDigestMap(directoryRoot);
    unlinkSync(join(directoryRoot, "bin/cli/api.mjs"));
    mkdirSync(join(directoryRoot, "bin/cli/api.mjs"), { mode: 0o700 });
    expect(
      inspectFixture(directoryRoot, directoryDigests).sources.find(({ id }) => id === "cli-api")
        ?.error,
    ).toBe("source_not_regular_file");

    const symlinkRoot = makePackageFixture();
    const symlinkDigests = fixtureDigestMap(symlinkRoot);
    const sourcePath = join(symlinkRoot, "bin/cli/api.mjs");
    const backingPath = join(symlinkRoot, "api-backing.mjs");
    writeFileSync(backingPath, readFileSync(sourcePath));
    unlinkSync(sourcePath);
    symlinkSync(backingPath, sourcePath);
    const symlinkReceipt = inspectFixture(symlinkRoot, symlinkDigests);
    expect(symlinkReceipt.classification).toBe("contract_unverified");
    expect(symlinkReceipt.sources.find(({ id }) => id === "cli-api")?.symbolicLink).toBe(true);
  });

  test("resolves an injected which result through the real executable package layout", () => {
    const root = makePackageFixture();
    const launcher = join(makeTemporaryRoot("temperance-native-cli-launcher-"), "omniroute");
    symlinkSync(join(root, "bin/omniroute.mjs"), launcher);
    const receipt = inspectOmniRouteNativeCliReadiness({
      which: () => launcher,
      now: () => NOW,
    });
    expect(receipt.classification).toBe("contract_unverified");
    expect(receipt.digestPinSource).toBe("reviewed-omniroute-3.8.48");
    expect(receipt.resolution).toEqual({
      method: "bun-which-realpath",
      executable: "omniroute",
      resolved: true,
      executableRelativePath: "bin/omniroute.mjs",
      error: null,
    });
  });

  test("returns an unverified diagnostic when executable or injected root resolution fails", () => {
    expect(() =>
      inspectOmniRouteNativeCliReadiness({
        which: () => null,
        fixtureExpectedDigests: fixtureDigestMap(makePackageFixture()),
        now: () => NOW,
      }),
    ).toThrow("fixture_digest_injection_requires_fixture_resolution");

    const absent = inspectOmniRouteNativeCliReadiness({ which: () => null, now: () => NOW });
    expect(absent.classification).toBe("contract_unverified");
    expect(absent.resolution.error).toBe("omniroute_executable_not_found");
    expect(absent.sources.every(({ relativePath }) => !relativePath.startsWith("/"))).toBe(true);

    const target = makePackageFixture();
    const link = join(makeTemporaryRoot("temperance-native-cli-link-"), "package-link");
    symlinkSync(target, link);
    const linked = inspectOmniRouteNativeCliReadiness({ packageRoot: link, now: () => NOW });
    expect(linked.classification).toBe("contract_unverified");
    expect(linked.resolution.error).toBe("package_root_not_real_directory");

    expect(() =>
      inspectOmniRouteNativeCliReadiness({
        fixtureExpectedDigests: fixtureDigestMap(target),
        now: () => NOW,
      }),
    ).toThrow("fixture_digest_injection_requires_fixture_resolution");
    expect(() =>
      inspectOmniRouteNativeCliReadiness({
        packageRoot: target,
        fixtureExpectedDigests: {
          ...fixtureDigestMap(target),
          openapi: "not-a-digest",
        },
        now: () => NOW,
      }),
    ).toThrow("fixture_digest_map_invalid");
  });
});

describe("private readiness receipt", () => {
  test("creates a private root and one exclusive mode-0600 JSON receipt", () => {
    const packageRoot = makePackageFixture();
    const receipt = inspectFixture(packageRoot);
    const parent = makeTemporaryRoot("temperance-native-cli-receipt-");
    const root = join(parent, "receipts");
    const path = writeOmniRouteNativeCliReadinessReceipt(root, receipt, {
      fileName: "omniroute-native-cli-readiness-success.json",
    });
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(path).nlink).toBe(1);
    const stored = JSON.parse(readFileSync(path, "utf8"));
    expect(stored).toEqual(receipt);
    expect(stored).toMatchObject({
      observedAt: NOW.toISOString(),
      validity: "instant-observation",
      cacheable: false,
      replayAuthorized: false,
    });
    expect(() =>
      writeOmniRouteNativeCliReadinessReceipt(root, receipt, {
        fileName: "omniroute-native-cli-readiness-success.json",
      }),
    ).toThrow("receipt_exclusive_write_failed");
  });

  test("refuses non-private, symlinked, traversal, relative, and invalid receipt targets", () => {
    const receipt = inspectFixture(makePackageFixture());
    const broad = makeTemporaryRoot("temperance-native-cli-broad-");
    chmodSync(broad, 0o755);
    expect(() => writeOmniRouteNativeCliReadinessReceipt(broad, receipt)).toThrow(
      "receipt_root_mode_invalid",
    );

    const parent = makeTemporaryRoot("temperance-native-cli-symlink-");
    const backing = join(parent, "backing");
    mkdirSync(backing, { mode: 0o700 });
    const link = join(parent, "link");
    symlinkSync(backing, link);
    expect(() => writeOmniRouteNativeCliReadinessReceipt(link, receipt)).toThrow(
      "receipt_root_not_real_directory",
    );
    expect(() => writeOmniRouteNativeCliReadinessReceipt(join(link, "nested"), receipt)).toThrow(
      "receipt_root_not_real_directory",
    );

    const writableAncestor = join(parent, "writable-ancestor");
    const privateLeaf = join(writableAncestor, "private-leaf");
    mkdirSync(writableAncestor, { mode: 0o777 });
    chmodSync(writableAncestor, 0o777);
    mkdirSync(privateLeaf, { mode: 0o700 });
    expect(() => writeOmniRouteNativeCliReadinessReceipt(privateLeaf, receipt)).toThrow(
      "receipt_root_mode_invalid",
    );
    expect(() =>
      writeOmniRouteNativeCliReadinessReceipt(
        `${parent}${sep}child${sep}..${sep}receipts`,
        receipt,
      ),
    ).toThrow("receipt_root_not_absolute_canonical");
    expect(() => writeOmniRouteNativeCliReadinessReceipt("relative-receipts", receipt)).toThrow(
      "receipt_root_not_absolute_canonical",
    );
    expect(() =>
      writeOmniRouteNativeCliReadinessReceipt(parent, receipt, { fileName: "../escape.json" }),
    ).toThrow("receipt_file_name_invalid");
  });
});

describe("CLI and bundle surface", () => {
  test("accepts only help and the optional receipt root flag", () => {
    expect(parseOmniRouteNativeCliReadinessArguments([])).toEqual({});
    expect(parseOmniRouteNativeCliReadinessArguments(["--help"])).toBe("help");
    expect(parseOmniRouteNativeCliReadinessArguments(["--receipt-root", "/private/tmp/example"])).toEqual({
      receiptRoot: "/private/tmp/example",
    });
    for (const argv of [
      ["--live"],
      ["--expected-digest", "forbidden"],
      ["--receipt-root"],
      ["--receipt-root", "/one", "--receipt-root", "/two"],
      ["--help", "--receipt-root", "/one"],
    ]) {
      expect(() => parseOmniRouteNativeCliReadinessArguments(argv)).toThrow(
        OmniRouteNativeCliReadinessError,
      );
    }
  });

  test("bundles the CLI and runs its help path without package inspection", async () => {
    const root = makeTemporaryRoot("temperance-native-cli-bundle-");
    const outfile = join(root, "readiness-bundle.js");
    const build = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../../scripts/omniroute-native-cli-readiness.ts")],
      outdir: root,
      naming: "readiness-bundle.js",
      target: "bun",
    });
    expect(build.success).toBe(true);
    const bun = Bun.which("bun");
    expect(bun).not.toBeNull();
    const child = Bun.spawn([bun!, outfile, "--help"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, output, errorOutput] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(errorOutput).toBe("");
    expect(exitCode).toBe(0);
    expect(output).toContain("Offline static inspection only");
    expect(output).not.toContain("--live");
  });
});
