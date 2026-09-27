/**
 * LaunchAgent lifecycle adapter for macOS.
 *
 * Architecture independence: LaunchAgent behavior is identical on Apple Silicon
 * (arm64) and Intel (x86_64) -- the `launchctl` API is architecture-independent.
 * The plist XML format, load/unload semantics, and `launchctl print` output
 * parsing are the same on both architectures.
 *
 * Ephemeral-Mac CI gate: Tests use mock IO and never call real `launchctl`.
 * On non-darwin CI, the platform gate throws PLATFORM_UNSUPPORTED which the
 * planner converts to an "unsupported" outcome -- tests verify this path
 * explicitly. Real LaunchAgent integration testing requires a macOS host
 * (darwin) and is covered by the verification gate in the plan.
 *
 * All operations accept LifecycleIO as parameter (execFile for launchctl,
 * writeFile/readFile for plist). No direct child_process imports.
 */

import { createHash } from "node:crypto";

import type { LifecycleIO } from "./journal.ts";

// ─── Plist rendering ──────────────────────────────────────────────────────────

/**
 * Render a plist XML template by replacing {{key}} placeholders with values
 * from the bindings map. Deterministic: same template + bindings always
 * produces the same output.
 */
export function renderPlist(template: string, bindings: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(bindings)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

// ─── Platform gate ────────────────────────────────────────────────────────────

/**
 * Assert that the current platform is macOS (darwin).
 * Throws PLATFORM_UNSUPPORTED on non-darwin -- the planner catches this
 * and converts to an "unsupported" outcome (matching existing pattern).
 */
export function assertDarwin(): void {
  if (process.platform !== "darwin") {
    throw new Error("PLATFORM_UNSUPPORTED");
  }
}

// ─── LaunchAgent queries ──────────────────────────────────────────────────────

/**
 * Check if a LaunchAgent with the given label is loaded in launchd.
 * Uses `launchctl print gui/<uid>/<label>` -- returns true if exit code is 0.
 */
export async function isLoaded(label: string, io: LifecycleIO, signal?: AbortSignal): Promise<boolean> {
  assertDarwin();
  const uid = process.getuid?.() ?? 0;
  try {
    const result = await io.execFile(
      "launchctl",
      ["print", `gui/${uid}/${label}`],
      { signal: signal ?? AbortSignal.timeout(3000) },
    );
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ─── Load / Unload ────────────────────────────────────────────────────────────

/**
 * Load a LaunchAgent plist via `launchctl load -w <plistPath>`.
 * Idempotent: caller should check isLoaded() first and skip if already loaded.
 */
export async function loadAgent(
  plistPath: string,
  io: LifecycleIO,
  signal?: AbortSignal,
): Promise<void> {
  assertDarwin();
  const result = await io.execFile(
    "launchctl",
    ["load", "-w", plistPath],
    { signal: signal ?? AbortSignal.timeout(5000) },
  );
  if (result.exitCode !== 0) {
    throw new Error(`launchctl load failed (exit ${result.exitCode}): ${result.stderr}`);
  }
}

/**
 * Unload a LaunchAgent by label via `launchctl unload -w <label>`.
 * Idempotent: caller should check isLoaded() first and skip if not loaded.
 */
export async function unloadAgent(
  label: string,
  io: LifecycleIO,
  signal?: AbortSignal,
): Promise<void> {
  assertDarwin();
  const uid = process.getuid?.() ?? 0;
  const result = await io.execFile(
    "launchctl",
    ["unload", "-w", `gui/${uid}/${label}`],
    { signal: signal ?? AbortSignal.timeout(5000) },
  );
  if (result.exitCode !== 0) {
    // Unload of a not-loaded agent may fail -- treat as idempotent
    // Only throw if it's a real error (non-zero AND stderr has content)
    if (result.stderr && result.stderr.trim().length > 0) {
      throw new Error(`launchctl unload failed (exit ${result.exitCode}): ${result.stderr}`);
    }
  }
}

// ─── Health probe ─────────────────────────────────────────────────────────────

/**
 * Probe LaunchAgent health using the same pattern as doctor host.ts:
 * `launchctl print gui/<uid>/<label>` -- parse exit code + stdout.
 *
 * Returns {healthy: true} if the agent is loaded and responding.
 * Returns {healthy: false, reason: ...} if not loaded or errored.
 */
export async function probeHealth(
  label: string,
  io: LifecycleIO,
  signal?: AbortSignal,
): Promise<{ healthy: boolean; reason: string }> {
  if (process.platform !== "darwin") {
    return { healthy: false, reason: "not macOS" };
  }
  const uid = process.getuid?.() ?? 0;
  try {
    const result = await io.execFile(
      "launchctl",
      ["print", `gui/${uid}/${label}`],
      { signal: signal ?? AbortSignal.timeout(3000) },
    );
    if (result.exitCode === 0) {
      return { healthy: true, reason: "loaded" };
    }
    return { healthy: false, reason: `exit ${result.exitCode}` };
  } catch {
    return { healthy: false, reason: "not loaded" };
  }
}

// ─── Plist verification ──────────────────────────────────────────────────────

/**
 * Verify an installed plist matches the expected content by sha256 comparison.
 * Reads the installed plist, computes sha256, compares with expected hash.
 */
export async function verifyPlist(
  expectedSha256: string,
  plistPath: string,
  io: LifecycleIO,
): Promise<boolean> {
  try {
    const content = await io.readFile(plistPath);
    const actualHash = createHash("sha256").update(content).digest("hex");
    return actualHash === expectedSha256;
  } catch {
    return false;
  }
}

/**
 * Compute sha256 of a string.
 */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
