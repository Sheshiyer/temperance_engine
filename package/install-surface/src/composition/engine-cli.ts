import { readFileSync } from "node:fs";
import { canonical } from "../canonical-json.ts";
import { createBareComposition, inspectCompositionV2 } from "./v2.ts";

/** Neutral inspection is independent of client, flow, router and memory installations. */
export function runEngineCommand(args: readonly string[], input?: string): { code: number; output: string } {
  try {
    const [command = "doctor", ...rest] = args;
    if (rest.some(argument => argument !== "--json")) throw new Error("ENGINE_ARGUMENT_INVALID");
    if (!["doctor", "inspect"].includes(command)) throw new Error("ENGINE_COMMAND_INVALID");
    if (input !== undefined && Buffer.byteLength(input) > 65536) throw new Error("ENGINE_INPUT_TOO_LARGE");
    const value = input === undefined || input.trim() === "" ? { manifest: createBareComposition(), descriptors: [] } : JSON.parse(input);
    const report = inspectCompositionV2(value.manifest, value.descriptors ?? [], value.observations);
    return { code: report.readiness === "held" ? 2 : 0, output: canonical(report) };
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "ENGINE_INPUT_INVALID";
    return { code: 2, output: canonical({ schema: "temperance.engine-error.v1", code, effect_authorized: false }) };
  }
}

if (import.meta.main) {
  const input = process.stdin.isTTY ? undefined : readFileSync(0, "utf8");
  const result = runEngineCommand(process.argv.slice(2), input);
  process.stdout.write(result.output);
  process.exitCode = result.code;
}
