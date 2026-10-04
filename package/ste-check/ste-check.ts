// ste-check.ts - a bun/TypeScript port of the upstream ASD-STE100 check tool.
//
// Upstream: https://github.com/0xpili/simplified-technical-english
//   scripts/ste_check.py at 1e148d670cba46685ad2b4c3f2354a637a7fdbbe (MIT, (c) 2026 0xpili)
//   Full license text: THIRD_PARTY_NOTICES.md. Usage and the docs gate: docs/ste.md.
//
// The port keeps the upstream rule numbers, message text, and output format, so the
// guidance in the upstream SKILL.md applies unchanged. Python `re` semantics differ
// from JavaScript in a few places (Unicode \w/\b/\d, the \s set, splitlines, and
// code-point string length); the helpers below emulate Python so output stays
// byte-identical. This file never embeds the ASD-STE100 word list; callers pass the
// path of an upstream word-list.md fetched by scripts/install-ste.sh.

export type Mode = "procedural" | "descriptive" | "mixed";
export const MODES: readonly Mode[] = ["procedural", "descriptive", "mixed"];

// ---------------------------------------------------------------- Python emulation

// Characters for which Python's str.isspace() is true (the `\s` set of a str pattern).
const PY_WS =
  "\\t\\n\\x0b\\x0c\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const S = `[${PY_WS}]`;
const NOT_S = `[^${PY_WS}]`;
// Python's Unicode `\w`, and `\b` next to a word character.
const W = "[\\p{L}\\p{N}_]";
const B_BEFORE = "(?<![\\p{L}\\p{N}_])";
const B_AFTER = "(?![\\p{L}\\p{N}_])";

const PY_LINE_BREAK = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/u;
const PY_STRIP = new RegExp(`^${S}+|${S}+$`, "gu");
const PY_SPLIT = new RegExp(`${S}+`, "u");

function pyStrip(s: string): string {
  return s.replace(PY_STRIP, "");
}

function pySplit(s: string): string[] {
  return pyStrip(s).split(PY_SPLIT).filter((p) => p !== "");
}

function pySplitlines(s: string): string[] {
  const lines = s.split(PY_LINE_BREAK);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function pyLen(s: string): number {
  return Array.from(s).length;
}

function isUpper(word: string): boolean {
  // str.isupper() for the ASCII words that the checks pass in.
  return /[A-Z]/.test(word) && !/[a-z]/.test(word);
}

/** Python universal-newlines mode: what read_text() and text-mode stdin return. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

// ---------------------------------------------------------------- constants

// Rule 3.5: the only approved "-ing" words in the STE dictionary.
export const ING_APPROVED = new Set([
  "mating", "missing", "remaining", // adjectives
  "lighting", "opening", "routing", "servicing", // nouns
  "during", // preposition
]);

// Words that end in "ing" where "ing" is not a verb suffix.
export const ING_NOT_SUFFIX = new Set([
  "ring", "spring", "string", "king", "thing", "wing", "sing",
  "bring", "sting", "swing", "nothing", "anything", "everything",
  "something", "bearing", "ceiling", "morning", "evening",
]);

// Rule 3.2 and the dictionary: approved helping verbs are CAN, MUST, WILL.
export const BANNED_MODALS = new Set(["should", "would", "may", "might", "shall", "ought"]);

const CONTRACTION = new RegExp(
  `${B_BEFORE}${W}+n't${B_AFTER}|${B_BEFORE}${W}+'(?:re|ll|ve|m)${B_AFTER}|` +
    `${B_BEFORE}(?:it|that|there|what|let|who|here|he|she)'s${B_AFTER}`,
  "iu",
);

const HAVE_PARTICIPLE = new RegExp(
  `${B_BEFORE}(?:has|have|had)${S}+(?:been|${W}+ed|done|made|gone|put|set|cut|kept|held|` +
    "taken|given|found|left|lost|meant|sent|shown|told|built|become|begun|" +
    "broken|brought|come|fallen|felt|got|gotten|grown|known|read|run|seen|" +
    `spoken|thrown|worn|written)${B_AFTER}`,
  "iu",
);

const COMPLEX_PASSIVE = new RegExp(
  `${B_BEFORE}(?:can|will|must|could|would|should|may|might|shall)${S}+` +
    `(?:not${S}+)?be${S}+${W}+(?:ed|en)${B_AFTER}|` +
    `${B_BEFORE}(?:is|are|was|were)${S}+to${S}+be${S}+${W}+(?:ed|en)${B_AFTER}`,
  "iu",
);

const PASSIVE_BY = new RegExp(
  `${B_BEFORE}(?:is|are|was|were|be|been|being)${S}+(?:${W}+${S}+)?${W}+(?:ed|en)${S}+by${B_AFTER}`,
  "iu",
);

const BE_ING = new RegExp(`${B_BEFORE}(?:is|are|was|were|be|been|am)${S}+${W}+ing${B_AFTER}`, "iu");

const SENT_SPLIT = new RegExp(`(?<=[.!?:])${S}+`, "u");
const WORDISH = /[A-Za-z0-9'&\/’-]+/g;

export const LIMITS: Record<Mode, number> = { procedural: 20, descriptive: 25, mixed: 25 };

// ---------------------------------------------------------------- helpers

/** Remove parts of the text that the STE rules do not control. */
export function stripMarkdown(text: string): string {
  text = text.replace(/^---\n[\s\S]*?\n---\n/, ""); // frontmatter
  text = text.replace(/```[\s\S]*?```/g, " "); // code blocks
  text = text.replace(/`[^`\n]+`/g, " CODE "); // inline code
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // links
  text = text.replace(new RegExp(`https?://${NOT_S}+`, "gu"), " URL "); // bare URLs
  text = text.replace(/(?<![^\n])>[^\n]*/g, " "); // block quotes
  // quoted text counts as one word and is not controlled (rule 8.6)
  text = text.replace(/"[^"\n]*"|“[^”\n]*”/g, " QUOTED ");
  return text;
}

function hasWordish(s: string): boolean {
  WORDISH.lastIndex = 0;
  return WORDISH.test(s);
}

/**
 * Count words with the STE conventions of section 8.
 *
 * A number, an identifier, a hyphenated group, and text in
 * parentheses each count as one word.
 */
export function countWords(sentence: string): number {
  let s = sentence.replace(/\([^)]*\)/g, " PAREN "); // rule 8.5
  s = s.replace(/\*\*|\*|__|_|#+/g, " "); // markdown marks
  return (s.match(WORDISH) ?? []).length; // hyphenated group = 1 (rule 8.7)
}

/** Divide a text block into sentences. */
export function iterSentences(block: string): string[] {
  const out: string[] = [];
  for (const raw of block.split(SENT_SPLIT)) {
    const part = pyStrip(raw);
    if (part && hasWordish(part)) out.push(part);
  }
  return out;
}

const WORD_LIST_LINE = new RegExp(
  `^([A-Z][A-Z' -]*[A-Z])${S}+\\((${W}+(?:, ${W}+)*)\\)(?:${S}+\\[([^\\n]*)\\])?`,
  "u",
);

/** Parse the text of word-list.md and return the set of approved word forms. */
export function parseWordList(text: string): Set<string> {
  const approved = new Set<string>();
  for (const line of pySplitlines(text)) {
    const m = WORD_LIST_LINE.exec(line);
    if (!m) continue;
    const head = m[1];
    const forms = m[3];
    for (const w of pySplit(head)) approved.add(w.toLowerCase());
    if (forms) {
      for (const f of forms.split(",")) {
        for (const w of pySplit(f)) approved.add(w.toLowerCase());
      }
    }
    // plurals of nouns (rule: plural of a countable noun is approved)
    if (line.includes("(n)")) {
      const word = head.toLowerCase();
      approved.add(word + "s");
      if (["s", "x", "ch", "sh"].some((end) => word.endsWith(end))) approved.add(word + "es");
      if (word.endsWith("y") && !"aeiou".includes(word.slice(-2, -1))) {
        approved.add(word.slice(0, -1) + "ies");
      }
    }
  }
  return approved;
}

/** Read word-list.md and return the set of approved word forms. */
export async function loadWordList(path: string): Promise<Set<string>> {
  return parseWordList(normalizeNewlines(await Bun.file(path).text()));
}

// ---------------------------------------------------------------- checks

export type Finding = [loc: string, rule: string, msg: string];

export class Report {
  errors: Finding[] = [];
  warnings: Finding[] = [];
  unknown = new Map<string, number>();

  error(loc: string, rule: string, msg: string): void {
    this.errors.push([loc, rule, msg]);
  }

  warn(loc: string, rule: string, msg: string): void {
    this.warnings.push([loc, rule, msg]);
  }
}

export function checkSentence(sent: string, mode: Mode, report: Report, loc: string): void {
  const limit = LIMITS[mode];
  const n = countWords(sent);
  const head = pyLen(sent) <= 60 ? sent : Array.from(sent).slice(0, 57).join("") + "...";
  if (n > 25) {
    report.error(loc, "5.1/6.3", `sentence has ${n} words (max ${limit}): "${head}"`);
  } else if (n > 20) {
    if (mode === "procedural") {
      report.error(loc, "5.1", `sentence has ${n} words (max 20): "${head}"`);
    } else if (mode === "mixed") {
      report.warn(loc, "5.1", `sentence has ${n} words (max 20 if procedural): "${head}"`);
    }
  }

  if (sent.includes(";")) {
    report.error(loc, "8.1", `semicolon found: "${head}". Write two sentences.`);
  }

  let m = CONTRACTION.exec(sent);
  if (m) report.error(loc, "4.2", `contraction "${m[0]}": write the full words.`);

  m = HAVE_PARTICIPLE.exec(sent);
  if (m) report.error(loc, "3.4", `helping verb structure "${m[0]}": use the simple past tense.`);

  m = COMPLEX_PASSIVE.exec(sent);
  if (m) report.error(loc, "3.4", `complex passive "${m[0]}": make the sentence active.`);

  m = PASSIVE_BY.exec(sent);
  if (m) report.error(loc, "3.6", `passive voice "${m[0]}": make the agent the subject.`);

  m = BE_ING.exec(sent);
  if (m) {
    const parts = pySplit(m[0]);
    const tail = parts[parts.length - 1].toLowerCase();
    if (!ING_APPROVED.has(tail)) {
      report.error(loc, "3.5", `progressive form "${m[0]}": use a simple tense.`);
    }
  }

  for (const word of sent.match(/[A-Za-z-]+/g) ?? []) {
    const lw = word.toLowerCase();
    if (BANNED_MODALS.has(lw)) {
      report.error(
        loc,
        "3.2",
        `"${word}" is not approved. Use "must" (requirement), "can" ` +
          `(possibility), "will" (future), or remove it.`,
      );
    } else if (lw === "could") {
      report.warn(loc, "3.2", '"could" is approved only as the past tense of "can".');
    } else if (lw.endsWith("ing") && lw.length > 4 && !isUpper(word)) {
      if (!ING_APPROVED.has(lw) && !ING_NOT_SUFFIX.has(lw)) {
        report.warn(loc, "3.5", `"${word}": an "-ing" form is permitted only in a technical name.`);
      }
    }
  }
}

export function checkVocab(text: string, report: Report, approved: Set<string>): void {
  for (const word of text.match(/[A-Za-z]+(?:-[A-Za-z]+)*/g) ?? []) {
    if (isUpper(word) || /[A-Z]/.test(word.slice(1))) continue; // acronym, identifier, or quoted text
    const lw = word.toLowerCase();
    if (approved.has(lw) || ING_APPROVED.has(lw) || lw.length <= 1) continue;
    if (lw.split("-").filter((p) => p).every((p) => approved.has(p))) continue;
    report.unknown.set(lw, (report.unknown.get(lw) ?? 0) + 1);
  }
}

function useVocab(approved: Set<string> | null): approved is Set<string> {
  return approved !== null && approved.size > 0;
}

export function checkParagraph(
  par: string,
  mode: Mode,
  report: Report,
  loc: string,
  approved: Set<string> | null,
): void {
  const sents = iterSentences(par);
  if (sents.length > 6) report.error(loc, "6.6", `paragraph has ${sents.length} sentences (max 6).`);
  for (const s of sents) checkSentence(s, mode, report, loc);
  if (useVocab(approved)) checkVocab(par, report, approved);
}

const PARAGRAPH_SPLIT = new RegExp(`\\n${S}*\\n`, "u");
const BULLET = new RegExp(`^${S}*(?:[-*+]|\\p{Nd}+\\.)${S}`, "u");
const BULLET_PREFIX = new RegExp(`^${S}*(?:[-*+]|\\p{Nd}+\\.)${S}+`, "u");

export function checkText(
  text: string,
  mode: Mode,
  report: Report,
  name: string,
  approved: Set<string> | null,
): void {
  text = stripMarkdown(text);
  const paragraphs = text.split(PARAGRAPH_SPLIT);
  paragraphs.forEach((raw, i) => {
    const par = pyStrip(raw);
    if (!par || !hasWordish(par)) return;
    // a heading or a table row is a title or quoted text (rule 8.6)
    if (par.startsWith("#") || par.startsWith("|")) return;
    const lines = pySplitlines(par);
    const items = lines.filter((l) => BULLET.test(l));
    const prose = lines.filter((l) => !BULLET.test(l));
    // a list item counts as its own sentence (rule 8.4)
    for (const l of items) {
      const item = l.replace(BULLET_PREFIX, "");
      for (const s of iterSentences(item)) checkSentence(s, mode, report, `${name}:list`);
      if (useVocab(approved)) checkVocab(item, report, approved);
    }
    if (prose.length > 0) {
      checkParagraph(prose.join("\n"), mode, report, `${name}:par${i + 1}`, approved);
    }
  });
}

/** Render a report exactly as the upstream tool prints it. */
export function formatReport(report: Report): string {
  const out: string[] = [];
  for (const [loc, rule, msg] of report.errors) out.push(`ERROR   ${loc} [rule ${rule}] ${msg}`);
  for (const [loc, rule, msg] of report.warnings) out.push(`WARNING ${loc} [rule ${rule}] ${msg}`);
  if (report.unknown.size > 0) {
    // Array.prototype.sort is stable, like Python's sorted(..., reverse=True).
    const words = [...report.unknown.keys()].sort(
      (a, b) => report.unknown.get(b)! - report.unknown.get(a)!,
    );
    out.push(`\nCHECK   ${words.length} words are not in the approved word list.`);
    out.push("        Each must be an approved technical name or technical verb:");
    for (let i = 0; i < words.length; i += 10) out.push("        " + words.slice(i, i + 10).join(", "));
  }
  out.push(`\nResult: ${report.errors.length} errors, ${report.warnings.length} warnings.`);
  if (report.errors.length === 0) {
    out.push("The text obeys the STE structural rules that this tool can check.");
    out.push("This tool cannot make sure that each word has its approved meaning.");
  }
  return out.join("\n") + "\n";
}
