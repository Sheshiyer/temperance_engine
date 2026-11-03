import { link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { canonical } from "../canonical-json.ts";
import { digest, frozen, type Digest } from "./boundary.ts";
import type { WorkLedgerV2, WorkReceiptV2 } from "./runtime-v2.ts";

/** Explicit local owner adapter. No IO occurs until claim/commit is requested. */
export function createFileWorkLedger(root: string): WorkLedgerV2 {
  if (!isAbsolute(root) || resolve(root) !== root) throw new Error("ENGINE_LEDGER_ROOT_INVALID");
  const claimed = new Set<Digest>();
  const file = (identity: Digest, suffix: string) => join(root, digest(identity).slice(7) + suffix);
  async function checkedRoot() {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("ENGINE_LEDGER_ROOT_UNSAFE");
  }
  async function read(identity: Digest): Promise<Readonly<WorkReceiptV2> | undefined> {
    const path = file(identity, ".json");
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error("ENGINE_LEDGER_RECEIPT_UNSAFE");
      const value = JSON.parse(await readFile(path, "utf8"));
      if (value.schema !== "temperance.work-receipt.v2" || value.identity_digest !== identity || value.persisted !== true || value.acceptance_asserted !== false) throw new Error("ENGINE_LEDGER_RECEIPT_INVALID");
      return frozen(value);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  return {
    async claim(identity) {
      await checkedRoot();
      if (await read(identity)) return "replay";
      try { await mkdir(file(identity, ".claim"), { mode: 0o700 }); claimed.add(identity); return "claimed"; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return (await read(identity)) ? "replay" : "in-progress"; throw error; }
    },
    async commit(identity, receipt) {
      if (!claimed.has(identity) || receipt.identity_digest !== identity || receipt.persisted !== true || receipt.acceptance_asserted !== false) throw new Error("ENGINE_LEDGER_CLAIM_REQUIRED");
      const bytes = canonical(frozen(receipt));
      if (Buffer.byteLength(bytes) > 65536) throw new Error("ENGINE_LEDGER_RECEIPT_TOO_LARGE");
      const target = file(identity, ".json");
      const temporary = file(identity, "." + randomBytes(12).toString("hex") + ".tmp");
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(bytes, "utf8"); await handle.sync(); } finally { await handle.close(); }
      try { await link(temporary, target); } finally { await unlink(temporary); }
      // The claim stays in place. Interrupted commits never release or steal it.
      const observed = await read(identity);
      if (!observed || canonical(observed) !== bytes) throw new Error("ENGINE_LEDGER_READBACK_FAILED");
      claimed.delete(identity);
    },
  };
}
