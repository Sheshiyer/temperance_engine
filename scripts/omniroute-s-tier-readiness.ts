#!/usr/bin/env bun

import { randomBytes } from "node:crypto";
import { accessSync, closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, type Stats } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, relative, resolve } from "node:path";
import {
  buildProbeSchedule,
  canonicalManifestBytes,
  createProbeRequest,
  createTelemetryReceipt,
  earlyControlsExpected,
  parseFixtureEvidence,
  parseSTierManifest,
  sanitizeHttpObservation,
  transportObservation,
  writePrivateReceipt,
  type SanitizedObservation,
  type STierManifest,
} from "../package/router/omniroute-s-tier-readiness";

const SOURCE_SCRIPT_NAME = "omniroute-s-tier-readiness.ts";
const MANIFEST_NAME = "omniroute-s-tier-candidates.ec2.json";

interface RuntimeContext {
  entryPath: string;
  codeBoundary: string;
  defaultManifestPath: string;
  layout: "source-tree" | "bundle";
}

interface CliOptions {
  mode: "fixture" | "live";
  manifestPath: string;
  fixturePath?: string;
  keyFile?: string;
  outputPath: string;
}

function usage(): string {
  return `Usage:
  bun scripts/omniroute-s-tier-readiness.ts --fixture <sanitized.json> --output <new-receipt.json> [--manifest <plan.json>]
  bun scripts/omniroute-s-tier-readiness.ts --live --key-file <protected-absolute-file-outside-repo> --output <new-receipt.json> [--manifest <plan.json>]

This command collects expiring, unauthenticated local falsification telemetry.
Every outcome is non-authoritative and cannot enable any route or provider.
`;
}

function parseArguments(argv: readonly string[], defaultManifestPath: string): CliOptions | "help" {
  let mode: CliOptions["mode"] | null = null;
  let manifestPath = defaultManifestPath;
  let fixturePath: string | undefined;
  let keyFile: string | undefined;
  let outputPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return "help";
    if (argument === "--live") {
      if (mode) throw new Error("mode_must_be_unique");
      mode = "live";
      continue;
    }
    if (["--fixture", "--manifest", "--key-file", "--output"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("argument_value_missing");
      index += 1;
      if (argument === "--fixture") {
        if (mode) throw new Error("mode_must_be_unique");
        mode = "fixture";
        fixturePath = resolve(value);
      } else if (argument === "--manifest") manifestPath = resolve(value);
      else if (argument === "--key-file") keyFile = value;
      else outputPath = resolve(value);
      continue;
    }
    throw new Error("argument_unknown");
  }
  if (!mode) throw new Error("mode_required");
  if (!outputPath) throw new Error("output_required");
  if (mode === "fixture" && (!fixturePath || keyFile)) throw new Error("fixture_arguments_invalid");
  if (mode === "live" && (fixturePath || !keyFile)) throw new Error("live_arguments_invalid");
  return { mode, manifestPath, ...(fixturePath ? { fixturePath } : {}), ...(keyFile ? { keyFile } : {}), outputPath };
}

function loadJson(path: string, code: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(code);
  }
}

export function pathWithin(path: string, parent: string): boolean {
  const relation = relative(resolve(parent), resolve(path));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export function resolveRuntimeContext(argvEntry: string | undefined): RuntimeContext {
  if (!argvEntry || !isAbsolute(argvEntry)) throw new Error("runtime_entry_not_absolute");
  const syntacticPath = resolve(argvEntry);
  let syntacticStat: Stats;
  let entryPath: string;
  let entryStat: Stats;
  try {
    syntacticStat = lstatSync(syntacticPath);
    if (syntacticStat.isSymbolicLink() || !syntacticStat.isFile()) throw new Error("runtime_entry_not_regular");
    entryPath = realpathSync(syntacticPath);
    entryStat = lstatSync(entryPath);
  } catch (error) {
    if (error instanceof Error && error.message === "runtime_entry_not_regular") throw error;
    throw new Error("runtime_entry_unavailable");
  }
  if (!entryStat.isFile() || entryStat.isSymbolicLink() || entryStat.dev !== syntacticStat.dev || entryStat.ino !== syntacticStat.ino) throw new Error("runtime_entry_not_regular");
  const possibleRoot = resolve(dirname(entryPath), "..");
  const sourceManifest = resolve(possibleRoot, "package/router", MANIFEST_NAME);
  const sourceCore = resolve(possibleRoot, "package/router/omniroute-s-tier-readiness.ts");
  const sourceLayout = basename(dirname(entryPath)) === "scripts" && basename(entryPath) === SOURCE_SCRIPT_NAME && existsSync(resolve(possibleRoot, ".git")) && existsSync(sourceManifest) && existsSync(sourceCore);
  return sourceLayout
    ? { entryPath, codeBoundary: possibleRoot, defaultManifestPath: sourceManifest, layout: "source-tree" }
    : { entryPath, codeBoundary: dirname(entryPath), defaultManifestPath: resolve(dirname(entryPath), MANIFEST_NAME), layout: "bundle" };
}

function readExactRuntimeEntry(context: RuntimeContext): Buffer {
  const before = lstatSync(context.entryPath);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("runtime_entry_not_regular");
  let fd: number | null = null;
  try {
    fd = openSync(context.entryPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.uid !== before.uid || opened.gid !== before.gid || opened.mode !== before.mode || opened.nlink !== before.nlink) throw new Error("runtime_entry_changed");
    return readFileSync(fd);
  } catch (error) {
    if (error instanceof Error && ["runtime_entry_not_regular", "runtime_entry_changed"].includes(error.message)) throw error;
    throw new Error("runtime_entry_read_failed");
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function readStrictCredential(path: string, codeBoundary = resolveRuntimeContext(process.argv[1]).codeBoundary): string {
  if (!isAbsolute(path)) throw new Error("credential_path_not_absolute");
  const syntacticPath = resolve(path);
  if (pathWithin(syntacticPath, codeBoundary)) throw new Error("credential_path_inside_code_boundary");
  let resolvedPath: string;
  let stat: Stats;
  let parentStat: Stats;
  try {
    const syntacticStat = lstatSync(syntacticPath);
    if (syntacticStat.isSymbolicLink()) throw new Error("credential_file_not_strict");
    resolvedPath = realpathSync(syntacticPath);
    stat = lstatSync(resolvedPath);
    parentStat = lstatSync(dirname(resolvedPath));
  } catch (error) {
    if (error instanceof Error && error.message === "credential_file_not_strict") throw error;
    throw new Error("credential_file_unavailable");
  }
  if (pathWithin(resolvedPath, realpathSync(codeBoundary))) throw new Error("credential_path_inside_code_boundary");
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !credentialMetadataAccepted(stat, parentStat, process.getuid?.() ?? -1)) throw new Error("credential_file_not_strict");
  let fd: number | null = null;
  let raw: string;
  try {
    fd = openSync(resolvedPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.uid !== stat.uid || opened.gid !== stat.gid || opened.mode !== stat.mode || opened.nlink !== stat.nlink) throw new Error("credential_file_changed");
    raw = readFileSync(fd, "utf8");
  } catch (error) {
    if (error instanceof Error && error.message === "credential_file_changed") throw error;
    throw new Error("credential_file_read_failed");
  } finally {
    if (fd !== null) closeSync(fd);
  }
  const credential = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
  if (credential.length < 16 || credential.length > 4096 || raw !== credential && raw !== `${credential}\n` || /[\s\u0000-\u001f\u007f]/u.test(credential)) throw new Error("credential_file_content_invalid");
  return credential;
}

export function credentialMetadataAccepted(file: Pick<Stats, "uid" | "gid" | "mode">, parent: Pick<Stats, "uid" | "gid" | "mode"> & { isDirectory(): boolean; isSymbolicLink(): boolean }, currentUid: number): boolean {
  const fileMode = file.mode & 0o777;
  if (file.uid === currentUid && fileMode === 0o600) return true;
  return fileMode === 0o640 && file.uid === 0 && file.gid > 0 && parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o777) === 0o750 && parent.uid === 0 && parent.gid === file.gid;
}

function executablePresent(name: string): boolean {
  if (!/^[A-Za-z0-9._-]+$/u.test(name)) return false;
  const pathValue = process.env.PATH ?? "";
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    try {
      accessSync(resolve(directory, name), fsConstants.X_OK);
      return true;
    } catch {
      // Absence is the deterministic prerequisite result; no subprocess runs.
    }
  }
  return false;
}

async function boundedResponseText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("response_body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

export interface LiveCollectionDependencies {
  fetchImpl?: typeof fetch;
  executablePresence?: Record<string, boolean>;
}

export async function collectLive(manifest: STierManifest, credential: string, nonce: string, dependencies: LiveCollectionDependencies = {}): Promise<{ executablePresence: Record<string, boolean>; observations: SanitizedObservation[] }> {
  const executablePresence = dependencies.executablePresence ?? Object.fromEntries(manifest.candidates.flatMap((candidate) => candidate.prerequisite ? [[candidate.prerequisite.name, executablePresent(candidate.prerequisite.name)]] : []));
  const schedule = buildProbeSchedule(manifest, executablePresence);
  const observations: SanitizedObservation[] = [];
  const totalDeadline = Date.now() + manifest.limits.total_timeout_ms;
  const executeEntry = async (entry: (typeof schedule)[number]): Promise<void> => {
    const remaining = totalDeadline - Date.now();
    if (remaining <= 0) {
      observations.push(transportObservation(entry, "timeout"));
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(remaining, manifest.limits.per_request_timeout_ms));
    try {
      const response = await (dependencies.fetchImpl ?? fetch)(manifest.endpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${credential}`,
          "content-type": "application/json",
          "x-omniroute-compression": "off",
        },
        body: JSON.stringify(createProbeRequest(manifest, entry, nonce)),
      });
      const body = await boundedResponseText(response, manifest.limits.max_response_bytes);
      observations.push(sanitizeHttpObservation(entry, response.status, response.headers, body, nonce));
    } catch (error) {
      const timeoutObserved = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      observations.push(transportObservation(entry, timeoutObserved ? "timeout" : "network"));
    } finally {
      clearTimeout(timeout);
    }
  };
  for (const entry of schedule.filter((item) => item.kind === "pin_before" || item.kind === "mismatch")) {
    await executeEntry(entry);
  }
  if (earlyControlsExpected(manifest, observations)) {
    for (const entry of schedule.filter((item) => item.kind === "candidate")) await executeEntry(entry);
  }
  await executeEntry(schedule.find((item) => item.kind === "pin_after")!);
  return { executablePresence, observations };
}

export async function runCli(argv: readonly string[]): Promise<number> {
  try {
    const runtime = resolveRuntimeContext(process.argv[1]);
    const options = parseArguments(argv, runtime.defaultManifestPath);
    if (options === "help") {
      process.stdout.write(usage());
      return 0;
    }
    const manifest = parseSTierManifest(loadJson(options.manifestPath, "manifest_read_failed"));
    const manifestBytes = canonicalManifestBytes(manifest);
    const probeSourceBytes = readExactRuntimeEntry(runtime);
    const nonce = randomBytes(16).toString("hex");
    let executablePresence: Record<string, boolean>;
    let observations: SanitizedObservation[];
    if (options.mode === "fixture") {
      const fixture = parseFixtureEvidence(loadJson(options.fixturePath!, "fixture_read_failed"));
      executablePresence = fixture.executable_presence;
      observations = fixture.observations;
    } else {
      const credential = readStrictCredential(options.keyFile!, runtime.codeBoundary);
      ({ executablePresence, observations } = await collectLive(manifest, credential, nonce));
    }
    const receipt = createTelemetryReceipt({ manifest, evidenceMode: options.mode, executablePresence, observations, nonce, manifestCanonicalBytes: manifestBytes, probeSourceBytes });
    writePrivateReceipt(options.outputPath, receipt);
    process.stdout.write(`${JSON.stringify({ telemetryCompleted: true, evidenceMode: options.mode, receiptWritten: true })}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error && /^[a-z0-9_]+$/u.test(error.message) ? error.message : "operation_failed";
    process.stderr.write(`s-tier-falsifier-error:${message}\n`);
    return 2;
  }
}

if (import.meta.main) process.exit(await runCli(process.argv.slice(2)));
