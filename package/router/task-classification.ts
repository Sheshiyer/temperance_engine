/** Legacy classify-task.sh behavior under LC_ALL=C; no runtime routing policy. */
export type TaskType =
  | "ralph" | "optimize" | "dispatch" | "media" | "vision" | "research"
  | "plan-max" | "plan" | "long-horizon" | "reasoning" | "validation"
  | "creative" | "fast" | "inline" | "balanced";

export interface ClassificationResult {
  taskType: TaskType;
  preferred: string;
}

// POSIX C-locale alnum excludes underscores and non-ASCII characters. Explicit
// boundaries also avoid JavaScript's Unicode case-folding and word semantics.
function keyword(alternation: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])(${alternation})([^a-z0-9]|$)`);
}

const RULES: ReadonlyArray<readonly [TaskType, RegExp]> = [
  ["ralph", keyword("ralph|maestro|ephemeral feature|isolated context|feature loop")],
  ["optimize", keyword("autoresearch|hill-?climb|optimize loop|eval mode|keep/discard|karpathy")],
  ["dispatch", keyword("dispatch|parallel workers|paid fleet|noesis-execute|swarm fan-?out")],
  ["media", keyword("elevenlabs|runway|text-to-speech|tts|image-to-video|meshy|voiceover|voice over")],
  ["vision", keyword("screenshot|vision bridge|noesis-vision|image audit")],
  ["research", keyword("literature|cite sources|web search|search evidence|noesis-research")],
  ["plan-max", keyword("plan-max|noesis-plan-max|architecture decision|system design|multi-?milestone|deep pass|task graph")],
  ["plan", keyword("roadmap|spec|architecture|implementation plan")],
  // grep's dot is bounded by LF only, unlike JavaScript's dot (CR/U+2028/U+2029).
  ["long-horizon", keyword("refactor|rewrite|migrate|redesign|overhaul|restructure|entire|all files|across[^\\n]*files")],
  ["reasoning", keyword("analyze|debug|diagnose|explain|understand|reason|think|complex|difficult")],
  ["validation", keyword("validate|verify|review|check|audit|test|ensure|confirm")],
  ["creative", keyword("brainstorm|creative|design|explore|imagine|ideate|alternative")],
  ["fast", keyword("quick|simple|small|minor|tweak|fix typo|update comment")],
];
const INLINE = keyword("extract|classify|summarize|list|identify|find|count");
const INLINE_EXCLUSIONS = keyword("read|search|grep|edit|write|run|execute|test|build|compile");

export function classifyTaskType(prompt: string): TaskType {
  const lower = prompt.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  for (const [taskType, pattern] of RULES) {
    if (pattern.test(lower)) return taskType;
  }
  if (INLINE.test(lower) && !INLINE_EXCLUSIONS.test(lower)) return "inline";
  return "balanced";
}

export function preferredForTaskType(taskType: string): string {
  switch (taskType) {
    case "ralph": case "long-horizon": return "combo:noesis-build";
    case "optimize": case "reasoning": return "combo:noesis-observe";
    case "dispatch": return "combo:noesis-execute";
    case "media": return "combo:noesis-media";
    case "vision": return "combo:noesis-vision";
    case "research": return "combo:noesis-research";
    case "plan-max": return "combo:noesis-plan-max";
    case "plan": return "combo:noesis-plan";
    case "validation": return "combo:noesis-verify";
    case "creative": return "combo:noesis-creative";
    case "inline": return "inline:current-session";
    default: return "combo:noesis-fast";
  }
}

export function classifyTask(prompt: string): ClassificationResult {
  const taskType = classifyTaskType(prompt);
  return { taskType, preferred: preferredForTaskType(taskType) };
}
