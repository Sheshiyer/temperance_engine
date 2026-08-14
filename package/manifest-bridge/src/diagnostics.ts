import { existsSync, mkdirSync, renameSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateRoot } from './project';

const MAX_LOG_BYTES = 1_000_000;

export class ManifestDiagnostics {
  private readonly enabled: boolean;
  private readonly file: string;

  constructor(root = stateRoot(), level = process.env.TEMPERANCE_MANIFEST_LOG_LEVEL || 'off') {
    this.enabled = /^(debug|trace)$/i.test(level);
    this.file = join(root, 'logs', 'bridge-debug.jsonl');
  }

  request(input: { method?: string; path?: string; status?: number; duration_ms?: number }): void {
    this.write('http.request', input);
  }

  event(input: { kind?: string; project_id?: string; accepted?: boolean; outcome?: 'accepted' | 'deduplicated' | 'rejected'; error?: string }): void {
    this.write('event.ingest', input);
  }

  private write(kind: string, input: Record<string, unknown>): void {
    if (!this.enabled) return;
    try {
      mkdirSync(join(this.file, '..'), { recursive: true });
      if (existsSync(this.file) && statSync(this.file).size >= MAX_LOG_BYTES) {
        renameSync(this.file, `${this.file}.1`);
      }
      // Intentional allowlist: no request body, prompt, tool output, headers,
      // environment, or evidence body enters the debug trace.
      appendFileSync(this.file, `${JSON.stringify({ ts: new Date().toISOString(), service: 'temperance-manifest-bridge', kind, method: input.method, path: input.path, status: input.status, duration_ms: input.duration_ms, event_kind: input.kind, project_id: input.project_id, accepted: input.accepted, outcome: input.outcome, error: input.error })}\n`, 'utf8');
    } catch { /* diagnostics never change bridge availability */ }
  }
}
