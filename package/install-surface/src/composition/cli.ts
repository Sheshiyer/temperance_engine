import { projectComposition } from "./projection.ts";
import { canonical } from "../canonical-json.ts";
import { MAX_INPUT_BYTES } from "./contracts.ts";
import { inspectComposition } from "./inspect.ts";

export interface CompositionCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCompositionCommand(
  args: string[],
  readInput?: () => Promise<string> | string,
  now?: number,
): Promise<CompositionCommandResult> {
  if (!Array.isArray(args) || args.length !== 1 || !["inspect", "project"].includes(args[0]!)) {
    return {
      code: 2,
      stdout: "",
      stderr: `${JSON.stringify({ error: "COMPOSITION_CLI_INVALID_ARGUMENTS" })}\n`,
    };
  }

  if (typeof readInput !== "function") {
    return {
      code: 2,
      stdout: "",
      stderr: `${JSON.stringify({ error: "COMPOSITION_NO_INPUT" })}\n`,
    };
  }

  let rawInput: string;
  try {
    rawInput = await readInput();
  } catch {
    return {
      code: 2,
      stdout: "",
      stderr: `${JSON.stringify({ error: "COMPOSITION_READ_FAILED" })}\n`,
    };
  }

  if (typeof rawInput !== "string" || Buffer.byteLength(rawInput, "utf8") > MAX_INPUT_BYTES) {
    return {
      code: 2,
      stdout: "",
      stderr: `${JSON.stringify({ error: "COMPOSITION_SIZE_EXCEEDED" })}\n`,
    };
  }

  let packet: unknown;
  try {
    packet = JSON.parse(rawInput);
  } catch {
    return {
      code: 2,
      stdout: "",
      stderr: `${JSON.stringify({ error: "COMPOSITION_INVALID_JSON" })}\n`,
    };
  }

  if (
    !packet
    || typeof packet !== "object"
    || Array.isArray(packet)
    || Object.getPrototypeOf(packet) !== Object.prototype
  ) {
    return {
      code: 2,
      stdout: "",
      stderr: `${JSON.stringify({ error: "COMPOSITION_INVALID_PACKET" })}\n`,
    };
  }

  const keys = Object.keys(packet as Record<string, unknown>);
  if (
    keys.some((k) => !(args[0] === "project" ? ["manifest", "observations", "event", "receipt"] : ["manifest", "observations"]).includes(k))
    || (args[0] === "project" && (!("event" in packet) || !("receipt" in packet)))
    || !("manifest" in packet)
  ) {
    return {
      code: 2,
      stdout: "",
      stderr: `${JSON.stringify({ error: "COMPOSITION_INVALID_PACKET" })}\n`,
    };
  }

  const typedPacket = packet as { manifest: unknown; observations?: unknown; event?: unknown; receipt?: unknown };

  try {
    const report = args[0] === "project"
      ? projectComposition(typedPacket.manifest, typedPacket.observations, typedPacket.event, typedPacket.receipt, now ?? Date.now())
      : inspectComposition(typedPacket.manifest, typedPacket.observations, now);
    return {
      code: 0,
      stdout: canonical(report),
      stderr: "",
    };
  } catch (err) {
    const errorCode = (
      err instanceof Error && err.message.startsWith("COMPOSITION_")
    )
      ? err.message
      : "COMPOSITION_INSPECTION_FAILED";

    return {
      code: 2,
      stdout: "",
      stderr: `${JSON.stringify({ error: errorCode })}\n`,
    };
  }
}

export const readCompositionStdin = async (): Promise<string> => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of process.stdin) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > MAX_INPUT_BYTES) {
        return " ".repeat(MAX_INPUT_BYTES + 1);
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString("utf8");
};

if (import.meta.main) {
  const result = await runCompositionCommand(process.argv.slice(2), readCompositionStdin);
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exit(result.code);
}
