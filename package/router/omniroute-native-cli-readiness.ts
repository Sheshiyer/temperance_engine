import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const OMNIROUTE_NATIVE_CLI_READINESS_SCHEMA =
  "temperance.omniroute.native-cli-readiness.v1" as const;
export const SUPPORTED_OMNIROUTE_NATIVE_CLI_VERSION = "3.8.48" as const;

const MAX_SOURCE_BYTES = 524_288;
const MAX_PACKAGE_BYTES = 65_536;
const RECEIPT_FILE_PREFIX = "omniroute-native-cli-readiness";
const SHA256_HEX = /^[a-f0-9]{64}$/u;

export type NativeCliSourceId =
  | "package-manifest"
  | "compression-command"
  | "cli-api"
  | "cli-token-helper"
  | "management-policy"
  | "openapi";

interface SourceContract {
  id: NativeCliSourceId;
  relativePath: string;
  expectedSha256: string;
  maximumBytes: number;
  markers: ReadonlyArray<{ id: string; value: string }>;
}

export const OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT = [
  {
    id: "package-manifest",
    relativePath: "package.json",
    expectedSha256: "6f154e5c973158c95dcbb7211a5d2ec691c396948c71a30959a472e88adff626",
    maximumBytes: MAX_PACKAGE_BYTES,
    markers: [],
  },
  {
    id: "compression-command",
    relativePath: "bin/cli/commands/compression.mjs",
    expectedSha256: "5ddf420c99aea6ea72859fae27effeec5efcfd105a345afbd3cf74a4c1a52aa8",
    maximumBytes: MAX_SOURCE_BYTES,
    markers: [
      {
        id: "preview-handler",
        value: "export async function runCompressionPreview(opts, cmd) {",
      },
      {
        id: "preview-file-read",
        value: 'const body = JSON.parse(readFileSync(opts.file, "utf8"));',
      },
      {
        id: "preview-post-endpoint",
        value:
          'const res = await apiFetch("/api/compression/preview", { method: "POST", body });',
      },
      {
        id: "preview-command",
        value: '.command("preview")',
      },
      {
        id: "preview-required-file",
        value: '.requiredOption("--file <path>", t("compression.preview.file"))',
      },
      {
        id: "preview-action",
        value: ".action(runCompressionPreview);",
      },
    ],
  },
  {
    id: "cli-api",
    relativePath: "bin/cli/api.mjs",
    expectedSha256: "9584c48cb91d0dccfbd9ea86b71ffc082d27f92c2f09bfb7560c0cafb17b9033",
    maximumBytes: MAX_SOURCE_BYTES,
    markers: [
      {
        id: "api-token-import",
        value:
          'import { getCliToken, CLI_TOKEN_HEADER } from "./utils/cliToken.mjs";',
      },
      {
        id: "api-token-resolution",
        value:
          "const cliToken = opts.cliToken ?? process" +
          ".env.OMNIROUTE_CLI_TOKEN ?? (await getCliToken());",
      },
      {
        id: "api-token-header-guard",
        value: "if (cliToken && !headers.has(CLI_TOKEN_HEADER)) {",
      },
      {
        id: "api-token-header-set",
        value: "headers.set(CLI_TOKEN_HEADER, cliToken);",
      },
    ],
  },
  {
    id: "cli-token-helper",
    relativePath: "bin/cli/utils/cliToken.mjs",
    expectedSha256: "7cccffbbf267ee1e1f9ebf67feab66de943980b66b9d4f12f55b575d50795360",
    maximumBytes: MAX_SOURCE_BYTES,
    markers: [
      {
        id: "token-header-name",
        value: 'export const CLI_TOKEN_HEADER = "x-omniroute-cli-token";',
      },
      {
        id: "token-machine-id-import",
        value: 'const { machineIdSync } = await import("node-machine-id");',
      },
      {
        id: "token-empty-import-fallback",
        value: '  } catch {\n    _cached = "";\n  }',
      },
      {
        id: "token-return",
        value: "\n  return _cached;\n}",
      },
    ],
  },
  {
    id: "management-policy",
    relativePath: "src/server/authz/policies/management.ts",
    expectedSha256: "d0809be23364924113a46ecf91ace938d6cd7a305f583667ff46ab6061b9e2e1",
    maximumBytes: MAX_SOURCE_BYTES,
    markers: [
      {
        id: "management-token-function",
        value: "function hasValidCliToken(ctx: PolicyContext): boolean {",
      },
      {
        id: "management-loopback-gate",
        value: "if (!isLoopbackRequest(ctx)) return false;",
      },
      {
        id: "management-token-required",
        value:
          "const headers = ctx.request.headers;\n  const provided = headers.get(CLI_TOKEN_HEADER);\n  if (!provided) return false;",
      },
      {
        id: "management-token-expectations",
        value:
          "const expectedTokens = [getMachineTokenSync(), getLegacyCliTokenSync()].filter(Boolean);",
      },
      {
        id: "management-token-branch",
        value: "if (hasValidCliToken(ctx)) {",
      },
      {
        id: "management-token-grant",
        value:
          'return allow({ kind: "management_key", id: "cli", label: "local-cli-token" });',
      },
    ],
  },
  {
    id: "openapi",
    relativePath: "dist/docs/openapi.yaml",
    expectedSha256: "e9bdf16a6ea225b4e4cad5dcf7c1fc141a40ba168f3028593ad9ac4c75e76053",
    maximumBytes: MAX_SOURCE_BYTES,
    markers: [
      {
        id: "openapi-preview-operation",
        value: "  /api/compression/preview:\n    post:",
      },
      {
        id: "openapi-preview-summary",
        value: "summary: Preview compression for a message payload",
      },
      {
        id: "openapi-required-messages-mode",
        value: "required: [messages, mode]",
      },
      {
        id: "openapi-preview-modes",
        value:
          "                mode:\n                  type: string\n                  enum: [off, lite, standard, aggressive, ultra, rtk, stacked]",
      },
      {
        id: "openapi-preview-messages",
        value:
          "                messages:\n                  type: array\n                  items:\n                    type: object\n                    required: [role, content]",
      },
    ],
  },
] as const satisfies readonly SourceContract[];

export type NativeCliExpectedDigestMap = Record<NativeCliSourceId, string>;

export const OMNIROUTE_NATIVE_CLI_EXPECTED_SHA256 = Object.freeze(
  Object.fromEntries(
    OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.map(({ id, expectedSha256 }) => [id, expectedSha256]),
  ) as NativeCliExpectedDigestMap,
);

export type NativeCliReadinessCheck =
  | "cliCompressionPreviewRequiresFile"
  | "cliCompressionPreviewPostsExactEndpoint"
  | "cliApiInjectsExactCliTokenHeader"
  | "cliTokenImportFailureReturnsEmpty"
  | "managementRequiresLoopbackCliToken"
  | "openApiPreviewRequiresMessagesAndMode";

export interface NativeCliSourceObservation {
  id: NativeCliSourceId;
  relativePath: string;
  available: boolean;
  regularFile: boolean;
  symbolicLink: boolean;
  bytes: number | null;
  sha256: string | null;
  expectedSha256: string;
  digestMatches: boolean;
  markerPresence: Record<string, boolean>;
  markerOrderValid: boolean;
  error: string | null;
}

export interface OmniRouteNativeCliReadinessReceipt {
  schema: typeof OMNIROUTE_NATIVE_CLI_READINESS_SCHEMA;
  createdAt: string;
  observedAt: string;
  validity: "instant-observation";
  cacheable: false;
  replayAuthorized: false;
  mode: "offline-static-contract-inspection";
  classification: "contract_verified" | "contract_unverified";
  contractVerified: boolean;
  expectedPackage: {
    name: "omniroute";
    version: typeof SUPPORTED_OMNIROUTE_NATIVE_CLI_VERSION;
  };
  observedPackage: {
    name: string | null;
    version: string | null;
    nameMatches: boolean;
    versionMatches: boolean;
  };
  resolution: {
    method: "bun-which-realpath" | "injected-package-root";
    executable: "omniroute";
    resolved: boolean;
    executableRelativePath: "bin/omniroute.mjs" | null;
    error: string | null;
  };
  sourceAllowlist: string[];
  digestPinSource: "reviewed-omniroute-3.8.48" | "injected-hermetic-fixture";
  sources: NativeCliSourceObservation[];
  checks: Record<NativeCliReadinessCheck, boolean>;
  nonClaims: {
    integrityScope: "exact-reviewed-allowlist-file-digests";
    pinnedFileCount: 6;
    packageIntegrityComplete: false;
    entrypointResolutionPinned: false;
    loadedModuleGraphVerified: false;
    consumerPromotionUseAuthorized: false;
    transportBound: false;
    blockingCondition: "401 AUTH_001 unresolved";
    sameUidAncestorRaceEliminated: false;
    offlineInspectionOnly: true;
    networkAccessPerformed: false;
    socketAccessPerformed: false;
    installedCodeImported: false;
    installedCodeExecuted: false;
    tokenHelperImported: false;
    tokenHelperExecuted: false;
    credentialSourcesRead: false;
    authenticationEstablished: false;
    authorizationEstablished: false;
    semanticPreviewPerformed: false;
    semanticPreviewQualified: false;
    settingsMutationPerformed: false;
    settingsMutationAuthorized: false;
    providerPromotionAuthorized: false;
  };
}

export interface OmniRouteNativeCliReadinessResult {
  classification: "contract_verified" | "contract_unverified";
  receiptPath: string;
  receipt: OmniRouteNativeCliReadinessReceipt;
}

export interface NativeCliReadinessInspectionOptions {
  packageRoot?: string;
  which?: (executable: string) => string | null | undefined;
  now?: () => Date;
  fixtureExpectedDigests?: NativeCliExpectedDigestMap;
}

export interface NativeCliReadinessRunOptions {
  receiptRoot?: string;
}

export interface NativeCliReadinessWriteOptions {
  fileName?: string;
}

export class OmniRouteNativeCliReadinessError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "OmniRouteNativeCliReadinessError";
    this.code = code;
  }
}

interface ResolvedInstallation {
  root: string | null;
  method: "bun-which-realpath" | "injected-package-root";
  resolved: boolean;
  executableRelativePath: "bin/omniroute.mjs" | null;
  error: string | null;
}

interface ReadSourceResult {
  observation: NativeCliSourceObservation;
  content: string | null;
}

function fail(code: string): never {
  throw new OmniRouteNativeCliReadinessError(code);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalAbsolutePath(value: string): boolean {
  return (
    isAbsolute(value) &&
    resolve(value) === value &&
    value === value.normalize("NFC") &&
    !value.split(sep).includes("..")
  );
}

function pathInside(root: string, target: string): boolean {
  const relation = relative(root, target);
  return relation !== "" && !relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation);
}

function validateRealDirectory(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(path) === path;
  } catch {
    return false;
  }
}

function resolveInstallation(options: NativeCliReadinessInspectionOptions): ResolvedInstallation {
  if (options.packageRoot !== undefined) {
    if (!canonicalAbsolutePath(options.packageRoot)) {
      return {
        root: null,
        method: "injected-package-root",
        resolved: false,
        executableRelativePath: null,
        error: "package_root_not_absolute_canonical",
      };
    }
    if (!validateRealDirectory(options.packageRoot)) {
      return {
        root: null,
        method: "injected-package-root",
        resolved: false,
        executableRelativePath: null,
        error: "package_root_not_real_directory",
      };
    }
    return {
      root: options.packageRoot,
      method: "injected-package-root",
      resolved: true,
      executableRelativePath: null,
      error: null,
    };
  }

  const which = options.which ?? ((executable: string) => Bun.which(executable));
  let executablePath: string | null | undefined;
  try {
    executablePath = which("omniroute");
  } catch {
    executablePath = null;
  }
  if (!executablePath || !isAbsolute(executablePath)) {
    return {
      root: null,
      method: "bun-which-realpath",
      resolved: false,
      executableRelativePath: null,
      error: "omniroute_executable_not_found",
    };
  }

  try {
    const executable = realpathSync(executablePath);
    const executableStat = lstatSync(executable);
    if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
      throw new Error("omniroute_executable_not_regular");
    }
    const binDirectory = dirname(executable);
    if (basename(executable) !== "omniroute.mjs" || basename(binDirectory) !== "bin") {
      throw new Error("omniroute_executable_layout_invalid");
    }
    const root = realpathSync(dirname(binDirectory));
    if (!validateRealDirectory(root) || resolve(root, "bin/omniroute.mjs") !== executable) {
      throw new Error("omniroute_package_layout_invalid");
    }
    return {
      root,
      method: "bun-which-realpath",
      resolved: true,
      executableRelativePath: "bin/omniroute.mjs",
      error: null,
    };
  } catch (error) {
    const safeErrors = new Set([
      "omniroute_executable_not_regular",
      "omniroute_executable_layout_invalid",
      "omniroute_package_layout_invalid",
    ]);
    const code = error instanceof Error && safeErrors.has(error.message)
      ? error.message
      : "omniroute_resolution_failed";
    return {
      root: null,
      method: "bun-which-realpath",
      resolved: false,
      executableRelativePath: null,
      error: code,
    };
  }
}

function countOccurrences(content: string, marker: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(marker, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + marker.length;
  }
}

function markerObservations(
  content: string,
  markers: ReadonlyArray<{ id: string; value: string }>,
): { markerPresence: Record<string, boolean>; markerOrderValid: boolean } {
  const markerPresence: Record<string, boolean> = {};
  let previous = -1;
  let markerOrderValid = true;
  for (const marker of markers) {
    const index = content.indexOf(marker.value);
    const exactlyOnce = index >= 0 && countOccurrences(content, marker.value) === 1;
    markerPresence[marker.id] = exactlyOnce;
    if (!exactlyOnce || index <= previous) markerOrderValid = false;
    previous = index;
  }
  return { markerPresence, markerOrderValid };
}

function expectedDigestConfiguration(options: NativeCliReadinessInspectionOptions): {
  digests: NativeCliExpectedDigestMap;
  source: "reviewed-omniroute-3.8.48" | "injected-hermetic-fixture";
} {
  if (options.fixtureExpectedDigests === undefined) {
    return {
      digests: OMNIROUTE_NATIVE_CLI_EXPECTED_SHA256,
      source: "reviewed-omniroute-3.8.48",
    };
  }
  if (options.packageRoot === undefined || options.which !== undefined) {
    fail("fixture_digest_injection_requires_fixture_resolution");
  }
  const expectedIds = OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.map(({ id }) => id).sort();
  const observedIds = Object.keys(options.fixtureExpectedDigests).sort();
  if (expectedIds.join("\0") !== observedIds.join("\0")) fail("fixture_digest_map_invalid");
  for (const id of expectedIds) {
    if (!SHA256_HEX.test(options.fixtureExpectedDigests[id])) fail("fixture_digest_map_invalid");
  }
  return {
    digests: Object.freeze({ ...options.fixtureExpectedDigests }),
    source: "injected-hermetic-fixture",
  };
}

function unavailableSource(
  contract: SourceContract,
  expectedSha256: string,
  error: string,
): ReadSourceResult {
  return {
    observation: {
      id: contract.id,
      relativePath: contract.relativePath,
      available: false,
      regularFile: false,
      symbolicLink: false,
      bytes: null,
      sha256: null,
      expectedSha256,
      digestMatches: false,
      markerPresence: Object.fromEntries(contract.markers.map(({ id }) => [id, false])),
      markerOrderValid: contract.markers.length === 0,
      error,
    },
    content: null,
  };
}

function readSource(root: string, contract: SourceContract, expectedSha256: string): ReadSourceResult {
  const path = resolve(root, contract.relativePath);
  if (!pathInside(root, path)) {
    return unavailableSource(contract, expectedSha256, "source_path_outside_allowlist_root");
  }
  let before: Stats;
  try {
    before = lstatSync(path);
  } catch {
    return unavailableSource(contract, expectedSha256, "source_unavailable");
  }
  if (before.isSymbolicLink()) {
    const result = unavailableSource(contract, expectedSha256, "source_symbolic_link_refused");
    result.observation.symbolicLink = true;
    return result;
  }
  if (!before.isFile()) return unavailableSource(contract, expectedSha256, "source_not_regular_file");
  if (before.size > contract.maximumBytes) return unavailableSource(contract, expectedSha256, "source_too_large");

  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.uid !== before.uid ||
      opened.gid !== before.gid ||
      opened.mode !== before.mode ||
      opened.nlink !== before.nlink ||
      opened.size !== before.size ||
      opened.size > contract.maximumBytes
    ) {
      return unavailableSource(contract, expectedSha256, "source_identity_changed");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
      return unavailableSource(contract, expectedSha256, "source_changed_during_read");
    }
    const content = bytes.toString("utf8");
    if (content.includes("\u0000")) {
      return unavailableSource(contract, expectedSha256, "source_text_invalid");
    }
    const markers = markerObservations(content, contract.markers);
    const observedSha256 = sha256(bytes);
    return {
      observation: {
        id: contract.id,
        relativePath: contract.relativePath,
        available: true,
        regularFile: true,
        symbolicLink: false,
        bytes: bytes.byteLength,
        sha256: observedSha256,
        expectedSha256,
        digestMatches: observedSha256 === expectedSha256,
        markerPresence: markers.markerPresence,
        markerOrderValid: markers.markerOrderValid,
        error: null,
      },
      content,
    };
  } catch {
    return unavailableSource(contract, expectedSha256, "source_read_failed");
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function sourceMarkersValid(source: NativeCliSourceObservation, ids: readonly string[]): boolean {
  return (
    source.available &&
    source.regularFile &&
    !source.symbolicLink &&
    source.markerOrderValid &&
    ids.every((id) => source.markerPresence[id] === true)
  );
}

function sourceById(
  sources: readonly NativeCliSourceObservation[],
  id: NativeCliSourceId,
): NativeCliSourceObservation {
  const source = sources.find((candidate) => candidate.id === id);
  if (!source) fail("source_contract_internal_error");
  return source;
}

function parseObservedPackage(content: string | null): { name: string | null; version: string | null } {
  if (content === null) return { name: null, version: null };
  try {
    const value = JSON.parse(content) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { name: null, version: null };
    const record = value as Record<string, unknown>;
    return {
      name: typeof record.name === "string" && record.name.length <= 128 ? record.name : null,
      version:
        typeof record.version === "string" && record.version.length <= 64 ? record.version : null,
    };
  } catch {
    return { name: null, version: null };
  }
}

function allMarkersFor(sourceId: NativeCliSourceId): string[] {
  const source = OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.find(({ id }) => id === sourceId);
  return source ? source.markers.map(({ id }) => id) : [];
}

export function inspectOmniRouteNativeCliReadiness(
  options: NativeCliReadinessInspectionOptions = {},
): OmniRouteNativeCliReadinessReceipt {
  const observedAt = (options.now ?? (() => new Date()))().toISOString();
  const digestConfiguration = expectedDigestConfiguration(options);
  const resolution = resolveInstallation(options);
  const reads = OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.map((contract) =>
    resolution.root
      ? readSource(resolution.root, contract, digestConfiguration.digests[contract.id])
      : unavailableSource(contract, digestConfiguration.digests[contract.id], "package_unresolved"),
  );
  const sources = reads.map(({ observation }) => observation);
  const manifest = reads.find(({ observation }) => observation.id === "package-manifest")?.content ?? null;
  const observed = parseObservedPackage(manifest);
  const compression = sourceById(sources, "compression-command");
  const api = sourceById(sources, "cli-api");
  const token = sourceById(sources, "cli-token-helper");
  const management = sourceById(sources, "management-policy");
  const openapi = sourceById(sources, "openapi");

  const checks: Record<NativeCliReadinessCheck, boolean> = {
    cliCompressionPreviewRequiresFile: sourceMarkersValid(compression, [
      "preview-handler",
      "preview-file-read",
      "preview-command",
      "preview-required-file",
      "preview-action",
    ]),
    cliCompressionPreviewPostsExactEndpoint: sourceMarkersValid(compression, [
      "preview-handler",
      "preview-post-endpoint",
    ]),
    cliApiInjectsExactCliTokenHeader:
      sourceMarkersValid(api, allMarkersFor("cli-api")) &&
      sourceMarkersValid(token, ["token-header-name"]),
    cliTokenImportFailureReturnsEmpty: sourceMarkersValid(token, allMarkersFor("cli-token-helper")),
    managementRequiresLoopbackCliToken: sourceMarkersValid(
      management,
      allMarkersFor("management-policy"),
    ),
    openApiPreviewRequiresMessagesAndMode: sourceMarkersValid(openapi, allMarkersFor("openapi")),
  };

  const packageManifest = sourceById(sources, "package-manifest");
  const nameMatches = observed.name === "omniroute";
  const versionMatches = observed.version === SUPPORTED_OMNIROUTE_NATIVE_CLI_VERSION;
  const contractVerified =
    resolution.resolved &&
    packageManifest.available &&
    packageManifest.regularFile &&
    !packageManifest.symbolicLink &&
    nameMatches &&
    versionMatches &&
    sources.length === OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.length &&
    sources.every(
      ({ available, regularFile, symbolicLink, digestMatches }) =>
        available && regularFile && !symbolicLink && digestMatches,
    ) &&
    Object.values(checks).every(Boolean);

  return {
    schema: OMNIROUTE_NATIVE_CLI_READINESS_SCHEMA,
    createdAt: observedAt,
    observedAt,
    validity: "instant-observation",
    cacheable: false,
    replayAuthorized: false,
    mode: "offline-static-contract-inspection",
    classification: contractVerified ? "contract_verified" : "contract_unverified",
    contractVerified,
    expectedPackage: {
      name: "omniroute",
      version: SUPPORTED_OMNIROUTE_NATIVE_CLI_VERSION,
    },
    observedPackage: {
      name: observed.name,
      version: observed.version,
      nameMatches,
      versionMatches,
    },
    resolution: {
      method: resolution.method,
      executable: "omniroute",
      resolved: resolution.resolved,
      executableRelativePath: resolution.executableRelativePath,
      error: resolution.error,
    },
    sourceAllowlist: OMNIROUTE_NATIVE_CLI_SOURCE_CONTRACT.map(({ relativePath }) => relativePath),
    digestPinSource: digestConfiguration.source,
    sources,
    checks,
    nonClaims: {
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
    },
  };
}

function validatePrivateDirectory(path: string, requirePrivate: boolean): void {
  const stat = lstatSync(path);
  const uid = process.getuid?.();
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) {
    fail("receipt_root_not_real_directory");
  }
  if (uid === undefined) fail("receipt_root_owner_invalid");
  if (requirePrivate && stat.uid !== uid) fail("receipt_root_owner_invalid");
  if (!requirePrivate && stat.uid !== uid && stat.uid !== 0) {
    fail("receipt_root_ancestor_owner_invalid");
  }
  if ((stat.mode & 0o022) !== 0) fail("receipt_root_mode_invalid");
  if (requirePrivate && (stat.mode & 0o777) !== 0o700) fail("receipt_root_mode_invalid");
}

function createPrivateDirectoryChain(path: string, target: string): void {
  const parent = dirname(path);
  if (parent !== path) createPrivateDirectoryChain(parent, target);
  if (existsSync(path)) {
    validatePrivateDirectory(path, path === target);
    return;
  }
  if (parent === path) fail("receipt_root_parent_invalid");
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch {
    if (!existsSync(path)) fail("receipt_root_create_failed");
  }
  validatePrivateDirectory(path, path === target);
}

function ensurePrivateReceiptRoot(rootInput: string): string {
  if (!canonicalAbsolutePath(rootInput)) fail("receipt_root_not_absolute_canonical");
  createPrivateDirectoryChain(rootInput, rootInput);
  validatePrivateDirectory(rootInput, true);
  return realpathSync(rootInput);
}

function receiptFileName(receipt: OmniRouteNativeCliReadinessReceipt): string {
  const stamp = receipt.createdAt.replace(/[^0-9TZ]/gu, "");
  return `${RECEIPT_FILE_PREFIX}-${stamp}-${randomBytes(8).toString("hex")}.json`;
}

function validateReceiptFileName(value: string): void {
  if (
    basename(value) !== value ||
    value !== value.normalize("NFC") ||
    !/^omniroute-native-cli-readiness-[A-Za-z0-9._-]+\.json$/u.test(value)
  ) {
    fail("receipt_file_name_invalid");
  }
}

export function writeOmniRouteNativeCliReadinessReceipt(
  rootInput: string,
  receipt: OmniRouteNativeCliReadinessReceipt,
  options: NativeCliReadinessWriteOptions = {},
): string {
  const root = ensurePrivateReceiptRoot(rootInput);
  const fileName = options.fileName ?? receiptFileName(receipt);
  validateReceiptFileName(fileName);
  const path = resolve(root, fileName);
  if (!pathInside(root, path)) fail("receipt_path_outside_root");
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    const opened = fstatSync(descriptor);
    const uid = process.getuid?.();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      uid === undefined ||
      opened.uid !== uid ||
      (opened.mode & 0o777) !== 0o600
    ) {
      fail("receipt_file_postcondition_invalid");
    }
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
  } catch (error) {
    if (error instanceof OmniRouteNativeCliReadinessError) throw error;
    fail("receipt_exclusive_write_failed");
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  const stored = lstatSync(path);
  const uid = process.getuid?.();
  if (
    !stored.isFile() ||
    stored.isSymbolicLink() ||
    stored.nlink !== 1 ||
    uid === undefined ||
    stored.uid !== uid ||
    (stored.mode & 0o777) !== 0o600
  ) {
    fail("receipt_file_postcondition_invalid");
  }
  return path;
}

export function defaultOmniRouteNativeCliReadinessReceiptRoot(): string {
  return resolve(homedir(), ".temperance_engine/receipts/omniroute-native-cli-readiness");
}

export function runOmniRouteNativeCliReadiness(
  options: NativeCliReadinessRunOptions = {},
): OmniRouteNativeCliReadinessResult {
  const receipt = inspectOmniRouteNativeCliReadiness();
  const receiptPath = writeOmniRouteNativeCliReadinessReceipt(
    options.receiptRoot ?? defaultOmniRouteNativeCliReadinessReceiptRoot(),
    receipt,
  );
  return { classification: receipt.classification, receiptPath, receipt };
}
