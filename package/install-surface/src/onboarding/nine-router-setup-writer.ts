import { closeSync, existsSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { canonical } from "../canonical-json.ts";
import type { NineRouterGuidedSetupV1 } from "./public-contracts.ts";

export function writePrivateNineRouterSetup(outputPath: string, setup: NineRouterGuidedSetupV1): string {
  const output = resolve(outputPath);
  const parent = dirname(output);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || (parentStat.mode & 0o022) !== 0) {
    throw new Error("NINE_ROUTER_SETUP_PARENT_UNSAFE");
  }
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(output, "wx", 0o600);
    created = true;
    fchmodSync(descriptor, 0o600);
    const bytes = Buffer.from(`${canonical(setup)}\n`, "utf8");
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const parentDescriptor = openSync(parent, "r");
    try { fsyncSync(parentDescriptor); } finally { closeSync(parentDescriptor); }
    return output;
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) {
      try { unlinkSync(output); } catch { /* preserve the original failure */ }
    }
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("NINE_ROUTER_SETUP_OUTPUT_EXISTS");
    throw error;
  }
}
