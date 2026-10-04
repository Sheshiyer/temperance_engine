import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASELINE_SCHEMA, isolateHeadingsAndTables, runGate } from "./docs-gate";

const CLEAN = "Stop the pump. Open the valve.\n";
const ONE_ERROR = "Stop the pump; open the valve.\n";
const TWO_ERRORS = "Stop the pump; open the valve.\n\nDon't touch the cable.\n";

let root = "";

function write(path: string, text: string): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
}

function baseline(files: Record<string, number>): void {
  const entries = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { errors: v }]));
  write("baseline.json", JSON.stringify({ schema: BASELINE_SCHEMA, files: entries }));
}

async function gate(...args: string[]) {
  return runGate(["--root", root, "--scope", join(root, "scope.json"), "--baseline", join(root, "baseline.json"), ...args]);
}

async function baselineFiles(): Promise<Record<string, { errors: number }>> {
  return (await Bun.file(join(root, "baseline.json")).json()).files;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ste-gate-"));
  write(
    "scope.json",
    JSON.stringify({
      include: ["GUIDE.md", "docs/*.md"],
      exclude: ["docs/retired.md"],
      default_mode: "mixed",
      modes: { "GUIDE.md": "procedural" },
    }),
  );
  write("GUIDE.md", CLEAN);
  write("docs/a.md", ONE_ERROR);
  write("docs/retired.md", TWO_ERRORS);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("docs gate", () => {
  test("--init-baseline records every in-scope file and refuses to overwrite", async () => {
    expect((await gate("--init-baseline")).code).toBe(0);
    expect(await baselineFiles()).toEqual({ "GUIDE.md": { errors: 0 }, "docs/a.md": { errors: 1 } });
    expect((await gate("--init-baseline")).code).toBe(2);
  });

  test("passes when every file is at its baseline", async () => {
    baseline({ "GUIDE.md": 0, "docs/a.md": 1 });
    const result = await gate();
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("2 files, 0 failures, 0 can tighten.");
  });

  test("fails when a baselined file gets worse", async () => {
    baseline({ "GUIDE.md": 0, "docs/a.md": 1 });
    write("docs/a.md", TWO_ERRORS);
    const result = await gate();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("FAIL    docs/a.md: 2 errors (baseline 1)");
  });

  test("fails when a new file has any error", async () => {
    baseline({ "GUIDE.md": 0, "docs/a.md": 1 });
    write("docs/new.md", ONE_ERROR);
    const result = await gate();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("FAIL    docs/new.md: 1 errors (not in the baseline, so the limit is 0)");
  });

  test("a new clean file passes, and excluded files are ignored", async () => {
    baseline({ "GUIDE.md": 0, "docs/a.md": 1 });
    write("docs/new.md", CLEAN);
    expect((await gate()).code).toBe(0);
  });

  test("uses the per-file mode", async () => {
    baseline({ "GUIDE.md": 0, "docs/a.md": 1 });
    const longSentence = Array.from({ length: 22 }, () => "word").join(" ") + ".\n";
    write("GUIDE.md", longSentence); // 22 words: an error only in procedural mode
    write("docs/b.md", longSentence);
    const result = await gate();
    expect(result.stdout).toContain("FAIL    GUIDE.md: 1 errors (baseline 0)");
    expect(result.stdout).not.toContain("docs/b.md");
  });

  test("reports improvements, and --tighten lowers counts and drops stale entries", async () => {
    baseline({ "GUIDE.md": 0, "docs/a.md": 3, "docs/gone.md": 4 });
    const check = await gate();
    expect(check.code).toBe(0);
    expect(check.stdout).toContain("TIGHTEN docs/a.md: 1 errors (baseline 3)");
    expect(check.stdout).toContain("TIGHTEN docs/gone.md: not in scope or deleted");
    expect((await gate("--tighten")).code).toBe(0);
    expect(await baselineFiles()).toEqual({ "GUIDE.md": { errors: 0 }, "docs/a.md": { errors: 1 } });
  });

  test("--tighten never raises a count and still fails on a regression", async () => {
    baseline({ "GUIDE.md": 0, "docs/a.md": 1 });
    write("docs/a.md", TWO_ERRORS);
    const result = await gate("--tighten");
    expect(result.code).toBe(1);
    expect(await baselineFiles()).toEqual({ "GUIDE.md": { errors: 0 }, "docs/a.md": { errors: 1 } });
  });

  test("prose right after a heading or a table row is still checked", async () => {
    baseline({ "GUIDE.md": 0, "docs/a.md": 1 });
    write("docs/heading.md", "## Setup\nStop the pump; open the valve.\n");
    write("docs/table.md", "| a | b |\n|---|---|\nDon't touch the cable.\n");
    write("docs/indented-heading.md", "  ## Setup\nStop the pump; open the valve.\n");
    write("docs/indented-table.md", "   | a | b |\nDon't touch the cable.\n");
    const result = await gate();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("FAIL    docs/heading.md: 1 errors");
    expect(result.stdout).toContain("FAIL    docs/table.md: 1 errors");
    expect(result.stdout).toContain("FAIL    docs/indented-heading.md: 1 errors");
    expect(result.stdout).toContain("FAIL    docs/indented-table.md: 1 errors");
  });

  test("isolateHeadingsAndTables splits headings and table rows but not fenced code", () => {
    expect(isolateHeadingsAndTables("## A\ntext")).toBe("\n## A\n\ntext");
    expect(isolateHeadingsAndTables("| x |\ntext")).toBe("\n| x |\n\ntext");
    expect(isolateHeadingsAndTables("```sh\n# comment\n```")).toBe("```sh\n# comment\n```");
    // Indented headings and table rows, and any other line that would make the
    // checker skip its block, are isolated so they cannot hide the next lines.
    expect(isolateHeadingsAndTables("  ## A\ntext")).toBe("\n  ## A\n\ntext");
    expect(isolateHeadingsAndTables("   | x |\ntext")).toBe("\n   | x |\n\ntext");
    expect(isolateHeadingsAndTables("#hashtag\ntext")).toBe("\n#hashtag\n\ntext");
  });

  test("a missing baseline or an unknown argument exits 2", async () => {
    expect((await gate()).code).toBe(2);
    expect((await gate("--bogus")).code).toBe(2);
  });
});
