import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileWorkLedger } from "../src/composition/file-ledger-v2.ts";
import { digestValue, type WorkReceiptV2 } from "../src/engine.ts";

const identity = digestValue({ fixture: "durable-work-identity" });
const receipt: WorkReceiptV2 = {
  schema: "temperance.work-receipt.v2", identity_digest: identity,
  request_digest: digestValue({ fixture: "request" }), source_manifest_digest: digestValue({ fixture: "manifest" }),
  plant_id: "fixture-plant", run_id: "fixture-run", step_ref: "fixture-step", module_id: "fixture-module", operation_id: "fixture-operation",
  status: "completed", reason_code: "PROCESS_COMPLETED", persisted: true,
  callback_settled: true, cancellation_requested: false, actions: [], artifact_refs: [], acceptance_asserted: false,
};

test("a ledger root replaced after claim cannot receive the receipt", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "engine-ledger-root-"));
  const root = join(fixture, "ledger"), preserved = join(fixture, "preserved-ledger");
  try {
    const ledger = createFileWorkLedger(root);
    expect(await ledger.claim(identity)).toBe("claimed");
    await rename(root, preserved); await mkdir(root);
    await writeFile(join(root, "concurrent.txt"), "concurrent-owner-bytes");
    await expect(ledger.commit(identity, receipt)).rejects.toThrow("ENGINE_LEDGER_ROOT_CHANGED");
    expect(await readdir(root)).toEqual(["concurrent.txt"]);
    expect(await readFile(join(root, "concurrent.txt"), "utf8")).toBe("concurrent-owner-bytes");
    expect(await readdir(preserved)).toEqual([identity.slice(7) + ".claim"]);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("independent filesystem adapters compete for one durable claim", async () => {
  const root = await mkdtemp(join(tmpdir(), "engine-ledger-race-"));
  try {
    const a = createFileWorkLedger(root), b = createFileWorkLedger(root);
    const outcomes = await Promise.all([a.claim(identity), b.claim(identity)]);
    expect(outcomes.sort()).toEqual(["claimed", "in-progress"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a concurrent receipt file cannot be overwritten by commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "engine-ledger-immutable-"));
  try {
    const ledger = createFileWorkLedger(root);
    expect(await ledger.claim(identity)).toBe("claimed");
    const target = join(root, identity.slice(7) + ".json");
    await writeFile(target, "concurrent-owner-bytes");
    await expect(ledger.commit(identity, receipt)).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe("concurrent-owner-bytes");
    expect((await readdir(root)).sort()).toEqual([identity.slice(7) + ".claim", identity.slice(7) + ".json"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a killed process leaves its durable claim held for owner recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "engine-ledger-interrupt-"));
  const source = import.meta.resolve("../src/composition/file-ledger-v2.ts");
  const script = `import { createFileWorkLedger } from ${JSON.stringify(source)};
    console.log(await createFileWorkLedger(${JSON.stringify(root)}).claim(${JSON.stringify(identity)}));
    setInterval(() => {}, 1000);`;
  const child = Bun.spawn([process.execPath, "-e", script], { cwd: root, stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "" } });
  const reader = child.stdout.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("FIXTURE_CLAIM_TIMEOUT")), 5000); }),
    ]);
    expect(new TextDecoder().decode(first.value).trim()).toBe("claimed");
    child.kill("SIGKILL"); expect(await child.exited).not.toBe(0);
    expect(await createFileWorkLedger(root).claim(identity)).toBe("in-progress");
    expect(await readdir(root)).toEqual([identity.slice(7) + ".claim"]);
  } finally {
    clearTimeout(timer); child.kill(); await child.exited;
    reader.releaseLock(); await rm(root, { recursive: true, force: true });
  }
});
