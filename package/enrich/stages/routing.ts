// package/enrich/stages/routing.ts -- SP0 enrichment stage (owner: unit-routing).
// Emits: "routing: backends=<list> | preferred=<backend>:<model>" 
// Pure over ResolvedContext + prompt analysis; fail-open (never throws out of the function).
import type { Stage } from '../contract';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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

/** Quick task-type classification (mirrors router logic) */
function classifyTaskType(prompt: string): string {
  const lower = prompt.toLowerCase();
  
  if (/\b(quick|simple|minor|tweak|fix typo)\b/.test(lower)) return 'fast';
  if (/\b(refactor|rewrite|migrate|redesign|overhaul|entire|all files)\b/.test(lower)) return 'long-horizon';
  if (/\b(analyze|debug|diagnose|explain|reason|complex)\b/.test(lower)) return 'reasoning';
  if (/\b(validate|verify|review|check|audit|test)\b/.test(lower)) return 'validation';
  if (/\b(brainstorm|creative|design|explore|imagine)\b/.test(lower)) return 'creative';
  if (/\b(extract|classify|summarize|list|identify)\b/.test(lower) && 
      !/\b(read|search|edit|write|run|execute)\b/.test(lower)) return 'inline';
  
  return 'balanced';
}

/** Get preferred model for task type */
function getPreferred(taskType: string): string {
  const routing: Record<string, string> = {
    'fast': 'command-code:deepseek/deepseek-v4-flash',
    'long-horizon': 'command-code:moonshotai/Kimi-K2.7-Code',
    'reasoning': 'command-code:claude-fable-5',
    'validation': 'command-code:google/gemini-3.5-flash',
    'creative': 'command-code:claude-sonnet-5',
    'balanced': 'command-code:claude-sonnet-5',
    'inline': 'inline:current-session'
  };
  return routing[taskType] || routing['balanced'];
}

export const routing: Stage = (ctx) => {
  try {
    const backends = detectBackends();
    
    if (backends.length === 0) {
      return { line: '', degraded: false }; // No external backends available
    }
    
    const taskType = classifyTaskType(ctx.prompt);
    const preferred = getPreferred(taskType);
    
    return { 
      line: `routing: backends=${backends.join(',')} | task=${taskType} | preferred=${preferred}`, 
      degraded: false 
    };
  } catch {
    return { line: '', degraded: true };
  }
};
