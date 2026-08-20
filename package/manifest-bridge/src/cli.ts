import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ManifestCatalog } from './catalog';
import { ManifestServer } from './server';
import { RuntimeWatcher } from './watcher';
import { hookInputToEvent } from './hook-adapter';
import { initProject, readProjectIdentity, stateRoot } from './project';
import { debugSnapshot, formatDoctorReport, runManifestDoctor } from './doctor';

const HOME = homedir();
const stateDir = stateRoot();

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function usage(): void {
  console.log('Usage: bun run src/cli.ts <init|sync|serve|emit|hook|snapshot|projects|doctor|debug> [--cwd PATH] [--all] [--port PORT] [--no-watch] [--json] [--verbose]');
}

async function main(): Promise<void> {
  const command = process.argv[2] || 'serve';
  const catalog = new ManifestCatalog(stateDir);
  const cwd = resolve(arg('--cwd', process.cwd()));
  if (command === 'doctor') {
    if (process.argv.includes('--record') || process.argv.includes('--repair-duplicates')) {
      console.error('Manifest doctor is permanently read-only; repair and recording move to separately governed Phase 3 lifecycle commands.');
      process.exitCode = 2;
      return;
    }
    const report = await runManifestDoctor({ state_dir: stateDir, bridge_url: arg('--bridge-url', process.env.TEMPERANCE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766'), console_url: arg('--console-url', process.env.TEMPERANCE_MANIFEST_CONSOLE_URL || 'http://127.0.0.1:5173') });
    console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatDoctorReport(report, process.argv.includes('--verbose')));
    process.exitCode = report.exit_code;
    return;
  }
  if (command === 'debug') {
    const limit = Math.max(1, Math.min(200, Number(arg('--limit', '50')) || 50));
    console.log(JSON.stringify(debugSnapshot(stateDir, process.argv.includes('--all') ? undefined : arg('--project-id', ''), limit), null, 2));
    return;
  }
  if (command === 'init') {
    const result = initProject(cwd);
    catalog.ensureProject(result.identity);
    console.log(JSON.stringify({ command, ...result, state_dir: stateDir }, null, 2));
    return;
  }
  if (command === 'projects') {
    console.log(JSON.stringify({ projects: catalog.listProjects() }, null, 2));
    return;
  }
  if (command === 'sync') {
    const identity = readProjectIdentity(cwd) || initProject(cwd).identity;
    catalog.ensureProject(identity);
    const watcher = new RuntimeWatcher(catalog, { cwd, home: HOME, intervalMs: 1 });
    await watcher.sync();
    watcher.stop();
    console.log(JSON.stringify({ command, project: identity, snapshot: catalog.snapshot(identity.project_id) }, null, 2));
    return;
  }
  if (command === 'emit' || command === 'hook') {
    let input: unknown;
    try { input = JSON.parse(readFileSync(0, 'utf8')); } catch (error) {
      console.log(JSON.stringify({ accepted: false, error: error instanceof Error ? error.message : String(error) }));
      if (command === 'hook') return;
      process.exitCode = 1;
      return;
    }
    const result = catalog.ingest(command === 'hook' ? hookInputToEvent(input, cwd) : input);
    console.log(JSON.stringify(result));
    process.exitCode = command === 'hook' ? 0 : result.error ? 1 : 0;
    return;
  }
  if (command === 'snapshot') { console.log(JSON.stringify(catalog.snapshot(process.argv.includes('--all') ? undefined : arg('--project-id', 'all')), null, 2)); return; }
  if (command !== 'serve') { usage(); process.exitCode = 2; return; }
  const port = Number(arg('--port', '8766'));
  const server = new ManifestServer(catalog);
  const registeredCwds = catalog.listProjects().flatMap((project) => project.cwd ? [project.cwd] : []);
  const watcher = new RuntimeWatcher(catalog, { cwd, home: HOME, cwds: process.argv.includes('--all') ? registeredCwds : [cwd] });
  const address = await server.listen(port);
  if (!process.argv.includes('--no-watch')) watcher.start();
  console.log(JSON.stringify({ service: 'temperance-manifest-bridge', address: `http://${address.host}:${address.port}`, projects: '/projects', snapshot: '/snapshot?project_id=<id>', events: '/events?project_id=<id>', health: '/health', state_dir: stateDir, cwd, watching: !process.argv.includes('--no-watch'), project_scope: process.argv.includes('--all') ? 'all' : cwd }));
  const shutdown = async () => { watcher.stop(); await server.close(); process.exit(0); };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

await main();
