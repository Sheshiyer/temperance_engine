import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultWordListPath, runCli } from "./cli";
import {
  Report,
  checkSentence,
  checkText,
  countWords,
  iterSentences,
  normalizeNewlines,
  parseWordList,
  stripMarkdown,
  type Mode,
} from "./ste-check";

// Golden outputs in fixtures/expected/ were produced once by upstream
// scripts/ste_check.py at 1e148d670cba46685ad2b4c3f2354a637a7fdbbe. Locations in
// them use the relative path "fixtures/<name>.md", so the CLI runs from this dir.
const FIXTURES = ["procedure-clean", "procedure-violations", "descriptive-mixed", "unicode"];
const MODES: Mode[] = ["procedural", "descriptive", "mixed"];
const SYNTHETIC_WORD_LIST = "fixtures/word-list.synthetic.md";
const NO_ENV = {};

let previousCwd = "";
beforeAll(() => {
  previousCwd = process.cwd();
  process.chdir(import.meta.dir);
});
afterAll(() => process.chdir(previousCwd));

function errorsOf(text: string, mode: Mode = "mixed"): string[] {
  const report = new Report();
  checkText(text, mode, report, "t", null);
  return report.errors.map(([, rule]) => rule);
}

function warningsOf(text: string, mode: Mode = "mixed"): string[] {
  const report = new Report();
  checkText(text, mode, report, "t", null);
  return report.warnings.map(([, rule]) => rule);
}

describe("golden parity with upstream ste_check.py", () => {
  for (const name of FIXTURES) {
    for (const mode of MODES) {
      test(`${name} --mode ${mode}`, async () => {
        const expected = await Bun.file(`fixtures/expected/${name}.${mode}.txt`).text();
        const result = await runCli(["--mode", mode, "--word-list", SYNTHETIC_WORD_LIST, `fixtures/${name}.md`], NO_ENV);
        expect(result.stdout).toBe(expected);
        expect(result.code).toBe(expected.includes("\nResult: 0 errors,") ? 0 : 1);
      });
    }
    test(`${name} --mode mixed --no-vocab`, async () => {
      const expected = await Bun.file(`fixtures/expected/${name}.mixed.novocab.txt`).text();
      const result = await runCli(["--mode", "mixed", "--no-vocab", `fixtures/${name}.md`], NO_ENV);
      expect(result.stdout).toBe(expected);
    });
  }
});

describe("sentence rules", () => {
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ") + ".";

  test("5.1/6.3 sentence length depends on the mode", () => {
    expect(errorsOf(words(20), "procedural")).toEqual([]);
    expect(errorsOf(words(21), "procedural")).toEqual(["5.1"]);
    expect(errorsOf(words(21), "descriptive")).toEqual([]);
    expect(errorsOf(words(21), "mixed")).toEqual([]);
    expect(warningsOf(words(21), "mixed")).toEqual(["5.1"]);
    expect(errorsOf(words(25), "descriptive")).toEqual([]);
    expect(errorsOf(words(26), "descriptive")).toEqual(["5.1/6.3"]);
  });

  test("8.1 semicolons, 4.2 contractions, 3.2 modals", () => {
    expect(errorsOf("Stop the pump; open the valve.")).toEqual(["8.1"]);
    expect(errorsOf("Don't open the valve.")).toEqual(["4.2"]);
    expect(errorsOf("It's open.")).toEqual(["4.2"]);
    expect(errorsOf("You should open the valve.")).toEqual(["3.2"]);
    expect(warningsOf("It could stop.")).toEqual(["3.2"]);
  });

  test("3.4 helping verbs and complex passives, 3.6 passive voice, 3.5 progressive", () => {
    expect(errorsOf("The operator has adjusted the linkage.")).toEqual(["3.4"]);
    expect(errorsOf("The cover can be removed.")).toEqual(["3.4"]);
    expect(errorsOf("The pump was installed by the team.")).toEqual(["3.6"]);
    expect(errorsOf("The pump is running.")).toEqual(["3.5"]);
    expect(errorsOf("The parts are remaining.")).toEqual([]);
    expect(warningsOf("Configuring the router is optional.")).toEqual(["3.5"]);
    expect(warningsOf("The spring and the ring are in the box during the test.")).toEqual([]);
    expect(warningsOf("Use the ROUTING table.")).toEqual([]);
  });

  test("6.6 paragraphs have at most six sentences", () => {
    expect(errorsOf("A b. C d. E f. G h. I j. K l.")).toEqual([]);
    expect(errorsOf("A b. C d. E f. G h. I j. K l. M n.")).toEqual(["6.6"]);
  });

  test("long sentences are shortened to 57 code points in the message", () => {
    const report = new Report();
    const sent = "é".repeat(70) + ";";
    checkSentence(sent, "mixed", report, "t");
    expect(report.errors[0][2]).toBe(`semicolon found: "${"é".repeat(57)}...". Write two sentences.`);
  });
});

describe("text structure", () => {
  test("stripMarkdown removes frontmatter, code, links, URLs, block quotes, and quotes", () => {
    const text = '---\na: b\n---\n```\nx; y\n```\nSee `a;b` and [the doc](u) at https://x.y/z.\n> quote; here\nSay "it\'s fine".';
    expect(stripMarkdown(text)).toBe(" \nSee  CODE  and the doc at  URL \n \nSay  QUOTED .");
  });

  test("countWords counts parentheses, hyphen groups, and numbers as one word", () => {
    expect(countWords("Use the self-test (refer to the manual) on unit 15.")).toBe(7);
    // Upstream quirk kept for parity: "." is not a word character, so "1.5" is two words.
    expect(countWords("Use the self-test (refer to the manual) on unit 1.5.")).toBe(8);
    expect(countWords("**Bold** text_here ## mark")).toBe(4);
  });

  test("iterSentences splits after . ! ? and :", () => {
    expect(iterSentences("Stop. Go! Why? Note: this.")).toEqual(["Stop.", "Go!", "Why?", "Note:", "this."]);
  });

  test("headings, tables, and list items are handled like upstream", () => {
    expect(errorsOf("# Heading; with semicolon\n\n| a; b |")).toEqual([]);
    const report = new Report();
    checkText("- Stop the pump; open the valve.\n- Open it.", "mixed", report, "t", null);
    expect(report.errors).toEqual([["t:list", "8.1", 'semicolon found: "Stop the pump; open the valve.". Write two sentences.']]);
  });

  test("CRLF and CR input gives the same result as LF input", () => {
    const lf = "Stop the pump; open the valve.\n\nThe pump is running.\n";
    const run = (t: string) => {
      const r = new Report();
      checkText(normalizeNewlines(t), "mixed", r, "t", null);
      return r;
    };
    expect(run(lf.replace(/\n/g, "\r\n"))).toEqual(run(lf));
    expect(run(lf.replace(/\n/g, "\r"))).toEqual(run(lf));
  });
});

describe("word list", () => {
  test("parseWordList reads heads, forms, and noun plurals", async () => {
    const approved = parseWordList(await Bun.file(SYNTHETIC_WORD_LIST).text());
    for (const w of ["align", "aligns", "aligned", "stop", "stopped", "box", "boxes", "bus", "buses", "fly", "flies", "key", "keys", "unit", "units", "adjacent", "to", "the"]) {
      expect(approved.has(w)).toBe(true);
    }
    // Upstream quirks kept for parity: single letters and lower-case heads do not match.
    expect(approved.has("a")).toBe(false);
    expect(approved.has("lowercase")).toBe(false);
    expect(approved.has("flys")).toBe(true);
    expect(approved.has("keies")).toBe(false);
  });

  test("checkVocab skips acronyms, identifiers, and hyphen groups of approved words", () => {
    const approved = parseWordList("ALIGN (v) [ALIGNS, ALIGNED, ALIGNED]\nUNIT (n)\nTHE (art)\n");
    const report = new Report();
    checkText("The unit-align NASA camelCase widget aligns.", "mixed", report, "t", approved);
    expect([...report.unknown.keys()]).toEqual(["widget"]);
  });
});

describe("cli", () => {
  test("reads stdin and names the location stdin", async () => {
    const result = await runCli(["--no-vocab"], NO_ENV, async () => "Stop the pump; open the valve.\n");
    expect(result.stdout.startsWith("ERROR   stdin:par1 [rule 8.1]")).toBe(true);
    expect(result.code).toBe(1);
  });

  test("usage errors exit 2", async () => {
    expect((await runCli(["--mode", "fast"], NO_ENV)).code).toBe(2);
    expect((await runCli(["--bogus"], NO_ENV)).code).toBe(2);
    expect((await runCli(["--word-list", "missing.md", "fixtures/unicode.md"], NO_ENV)).code).toBe(2);
    expect((await runCli(["--no-vocab", "missing.md"], NO_ENV)).code).toBe(2);
  });

  test("without a word list, the vocabulary check is skipped with a note on stderr", async () => {
    const result = await runCli(["fixtures/procedure-clean.md"], NO_ENV);
    expect(result.stdout).not.toContain("CHECK");
    expect(result.stderr).toContain("--with-ste");
    expect(result.code).toBe(0);
  });

  test("defaultWordListPath prefers STE_SKILL_HOME, then AGENTS_HOME", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-wl-"));
    try {
      const ste = join(root, "ste");
      const agents = join(root, "agents");
      mkdirSync(join(ste, "references"), { recursive: true });
      mkdirSync(join(agents, "skills", "simplified-technical-english", "references"), { recursive: true });
      writeFileSync(join(agents, "skills", "simplified-technical-english", "references", "word-list.md"), "");
      expect(defaultWordListPath({ AGENTS_HOME: agents })).toBe(join(agents, "skills", "simplified-technical-english", "references", "word-list.md"));
      writeFileSync(join(ste, "references", "word-list.md"), "");
      expect(defaultWordListPath({ STE_SKILL_HOME: ste, AGENTS_HOME: agents })).toBe(join(ste, "references", "word-list.md"));
      expect(defaultWordListPath({ HOME: join(root, "nohome") })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
