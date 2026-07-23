// package/enrich/stages/routing.ts -- SP0 enrichment stage (owner: unit-routing).
// Emits: "routing: backends=<list> | task=<type> | portfolio=<name> | preferred=<backend>:<model> | skill=temperance-parallel-dispatch"
// The trailing "| skill=..." segment is only appended when backends are available
// (i.e. on the non-degraded, non-empty branch), giving the orchestrating agent a
// direct handoff to the parallel-dispatch skill.
// Pure over ResolvedContext + prompt analysis; fail-open (never throws out of the function).
import type { Stage } from '../contract';
import { execSync, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve the shared classifier script (package/router/classify-task.sh).
 *  The sibling-relative path holds when enrich runs from the repo OR from an
 *  install that co-locates `router/` next to `enrich/`. When enrich is installed
 *  somewhere that does NOT co-locate the router (e.g. ~/.claude/PAI/enrich with no
 *  sibling router/), set TEMPERANCE_ROUTER_DIR to the dir containing
 *  classify-task.sh. First existing candidate wins; if none exists we return the
 *  sibling path anyway so execFileSync fails cleanly into the fail-open default. */
function resolveClassifyScript(): string {
  const candidates: string[] = [];
  const envDir = process.env.TEMPERANCE_ROUTER_DIR;
  if (envDir) candidates.push(join(envDir, 'classify-task.sh'));
  candidates.push(join(__dirname, '..', '..', 'router', 'classify-task.sh'));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

/** Resolve the pure task-type -> OmniRoute portfolio resolver.  This is kept
 * as a subprocess boundary so an installed enrichment tree can remain
 * fail-open when the optional router tree is not co-located. */
function resolvePortfolioScript(): string {
  const candidates: string[] = [];
  const envPath = process.env.TEMPERANCE_OMNIROUTE_PORTFOLIO_RESOLVER;
  if (envPath) candidates.push(envPath);
  candidates.push(join(__dirname, '..', '..', 'router', 'omniroute-portfolios.ts'));
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[candidates.length - 1];
}

/** Detect available backends without calling the router (fast check) */
function detectBackends(): string[] {
  const backends: string[] = [];
  
  try {
    // command-code
    execSync('command -v command-code', { stdio: 'ignore' });
    backends.push('command-code');
  } catch {}
  
  try {
    // kimi
    execSync('command -v kimi', { stdio: 'ignore' });
    backends.push('kimi');
  } catch {}
  
  // grok
  if (existsSync(join(homedir(), '.grok', 'bin', 'grok'))) {
    backends.push('grok');
  }
  
  // nvidia
  if (process.env.NVIDIA_API_KEY) {
    backends.push('nvidia');
  }
  
  return backends;
}

/** Skill pointer appended only when backends are available (handoff for orchestrator). */
const SKILL_POINTER = 'temperance-parallel-dispatch';

/** Defer task-type + preferred model to the single source of truth
 *  (package/router/classify-task.sh). Fail-open to balanced on any error. */
function classifyViaShared(prompt: string): { taskType: string; preferred: string } {
  try {
    const out = execFileSync(resolveClassifyScript(), [prompt], { encoding: 'utf8' }).trim();
    const [taskType, preferred] = out.split('\t');
    if (taskType && preferred) return { taskType, preferred };
  } catch {
    /* fall through to fail-open default */
  }
  return { taskType: 'balanced', preferred: 'command-code:claude-sonnet-5' };
}

function portfolioViaShared(taskType: string): { requested: string; source: string } {
  try {
    const resolver = resolvePortfolioScript();
    // Use the current Bun runtime rather than PATH's `bun` name. Test and
    // installed environments intentionally use a minimal PATH.
    const out = execFileSync(process.execPath, [resolver, 'resolve', taskType], { encoding: 'utf8' }).trim();
    const parsed = JSON.parse(out) as { requested_portfolio?: unknown; source?: unknown };
    if (typeof parsed.requested_portfolio === 'string' && parsed.requested_portfolio.length > 0) {
      return {
        requested: parsed.requested_portfolio,
        source: typeof parsed.source === 'string' ? parsed.source : 'direct',
      };
    }
  } catch {
    /* Optional portfolio resolver absent or unavailable: preserve fail-open. */
  }
  return { requested: 'temperance-coding', source: 'compatibility-fallback' };
}

export const routing: Stage = (ctx) => {
  try {
    const backends = detectBackends();
    if (backends.length === 0) {
      return { line: '', degraded: false }; // No external backends available
    }
    const prompt = ctx.input?.prompt || '';
    const { taskType, preferred } = classifyViaShared(prompt);
    const portfolio = portfolioViaShared(taskType);
    return {
      line: `routing: backends=${backends.join(',')} | task=${taskType} | portfolio=${portfolio.requested} | portfolio_source=${portfolio.source} | preferred=${preferred} | skill=${SKILL_POINTER}`,
      degraded: false,
    };
  } catch {
    return { line: '', degraded: true };
  }
};
