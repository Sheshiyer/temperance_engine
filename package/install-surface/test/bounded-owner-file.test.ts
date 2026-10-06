import { describe, expect, test } from "bun:test";
import { constants, mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoundedOwnerFile, type OwnerFileFs, type OwnerFileMetadata } from "../src/transport/bounded-owner-file";
function fixture(text = "abc") {
  const bytes = Buffer.from(text); const meta: OwnerFileMetadata = { regular: true, dev: 1n, ino: 2n, size: BigInt(bytes.length), mtimeNs: 3n, ctimeNs: 4n };
  const allocations: number[] = []; let reads = 0, closes = 0, flags = 0;
  const fs: OwnerFileFs = {
    open(_, f) { flags = f; return 7; }, descriptorMetadata() { return { ...meta }; }, pathMetadata() { return { ...meta }; },
    read(_, buffer, offset, length, position) { reads++; const count = Math.min(length, Math.max(0, bytes.length - position)); bytes.copy(buffer, offset, position, position + count); return count; },
    allocate(n) { allocations.push(n); return Buffer.alloc(n); }, close() { closes++; },
  };
  return { fs, meta, bytes, allocations, reads: () => reads, closes: () => closes, flags: () => flags };
}
describe("bounded descriptor owner snapshot", () => {
  test("exact bound, raw bytes and native flags", () => {
    const f = fixture("☿"); expect(readBoundedOwnerFile("/synthetic",3,f.fs)).toEqual(f.bytes); expect(f.allocations).toEqual([3,1]); expect(f.closes()).toBe(1);
    expect(f.flags() & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW); expect(f.flags() & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
  });
  test("oversize rejects before allocation or read", () => {
    const f = fixture(); expect(() => readBoundedOwnerFile("/synthetic",2,f.fs)).toThrow("file-limit"); expect(f.allocations).toEqual([]); expect(f.reads()).toBe(0); expect(f.closes()).toBe(1);
  });
  test("zero bytes and short positional reads", () => {
    const z = fixture(""); expect(readBoundedOwnerFile("/synthetic",0,z.fs).length).toBe(0);
    const f = fixture("abcd"); const read = f.fs.read; const positions: number[] = [];
    f.fs.read = (fd,b,o,n,p) => { positions.push(p); return read(fd,b,o,Math.min(1,n),p); };
    expect(readBoundedOwnerFile("/synthetic",4,f.fs).toString()).toBe("abcd"); expect(positions).toEqual([0,1,2,3,4]);
  });
  test("truncation, growth, metadata drift and path replacement hold", () => {
    const f = fixture(); f.fs.read = () => 0; expect(() => readBoundedOwnerFile("/synthetic",3,f.fs)).toThrow("truncated"); expect(f.closes()).toBe(1);
    const g = fixture(); const read = g.fs.read; g.fs.read = (fd,b,o,n,p) => p === 3 ? 1 : read(fd,b,o,n,p); expect(() => readBoundedOwnerFile("/synthetic",3,g.fs)).toThrow("grew");
    const h = fixture(); let observations = 0; h.fs.descriptorMetadata = () => ({ ...h.meta, mtimeNs: ++observations === 1 ? 3n : 9n }); expect(() => readBoundedOwnerFile("/synthetic",3,h.fs)).toThrow("changed");
    const k = fixture(); k.fs.pathMetadata = () => ({ ...k.meta, ino: 99n }); expect(() => readBoundedOwnerFile("/synthetic",3,k.fs)).toThrow("path-changed");
    expect([g.closes(),h.closes(),k.closes()]).toEqual([1,1,1]);
  });
  test("unsupported type/metadata and invalid counts never allocate freely", () => {
    const f = fixture(); f.meta.regular = false; expect(() => readBoundedOwnerFile("/synthetic",3,f.fs)).toThrow("not-regular"); expect(f.allocations).toEqual([]);
    const g = fixture(); g.fs.read = () => 4; expect(() => readBoundedOwnerFile("/synthetic",3,g.fs)).toThrow("invalid-read-count"); expect(g.closes()).toBe(1);
    const h = fixture(); h.meta.size = -1n; expect(() => readBoundedOwnerFile("/synthetic",3,h.fs)).toThrow("metadata-failed"); expect(h.allocations).toEqual([]);
  });
  test("all operation failures use fixed redacted codes and close", () => {
    for (const field of ["descriptorMetadata","pathMetadata","read","allocate"] as const) {
      const f = fixture(); (f.fs as any)[field] = () => { throw new Error("private sentinel"); };
      let error: unknown; try { readBoundedOwnerFile("/private/path",3,f.fs); } catch(e) { error = e; }
      expect(String(error)).not.toContain("private"); expect(f.closes()).toBe(1);
    }
    const f = fixture(); f.fs.close = () => { throw new Error("private"); }; expect(() => readBoundedOwnerFile("/synthetic",3,f.fs)).toThrow("close-failed");
  });
  test("synthetic FIFO is opened nonblocking and rejected before reads", () => {
    const f = fixture(); f.fs.open = (_, flags) => { expect(flags & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK); return 7; };
    f.meta.regular = false; expect(() => readBoundedOwnerFile("/synthetic-fifo",3,f.fs)).toThrow("not-regular"); expect(f.reads()).toBe(0); expect(f.allocations).toEqual([]); expect(f.closes()).toBe(1);
    const g = fixture(); g.fs.open = () => { throw new Error("private open error"); }; expect(() => readBoundedOwnerFile("/synthetic",3,g.fs)).toThrow("open-failed"); expect(g.closes()).toBe(0);
  });
  test("invalid ceiling/path does not open", () => {
    const f = fixture(); f.fs.open = () => { throw new Error("must not open"); };
    expect(() => readBoundedOwnerFile("/x",4194305,f.fs)).toThrow("invalid-bound"); expect(() => readBoundedOwnerFile("x\0",1,f.fs)).toThrow("invalid-path");
  });
  test("native disposable regular file, directory and final symlink", () => {
    const root = mkdtempSync(join(tmpdir(),"owner-file-"));
    try { const path = join(root,"fixture"); writeFileSync(path,"fixture"); expect(readBoundedOwnerFile(path,7).toString()).toBe("fixture"); mkdirSync(join(root,"dir")); expect(() => readBoundedOwnerFile(join(root,"dir"),100)).toThrow("not-regular"); symlinkSync(path,join(root,"link")); expect(() => readBoundedOwnerFile(join(root,"link"),100)).toThrow("open-failed"); }
    finally { rmSync(root,{recursive:true,force:true}); }
  });
});
