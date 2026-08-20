import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ManifestCatalog } from './catalog';
import { ManifestServer } from './server';
import { RuntimeWatcher } from './watcher';
import { hookInputToEvent } from './hook-adapter';
import { identityForCwd, initProject, readProjectIdentity, stateRoot } from './project';
import { debugSnapshot, formatDoctorReport, runManifestDoctor } from './doctor';
import { readCodeGraphStatus } from './codegraph';
import { manifestRuntimeReceipt } from './runtime-status';

const HOME = homedir();
const stateDir = stateRoot();

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function usage(): void {
  console.log('Usage: bun run src/cli.ts <init|sync|serve|emit|hook|snapshot|projects|doctor|debug|codegraph|omniroute> [--cwd PATH] [--all] [--codegraph] [--gsd] [--skill-clusters] [--skill-index PATH] [--sync] [--omniroute-url URL] [--port PORT] [--no-watch] [--json] [--verbose] [--record] [--repair-duplicates]');
}

async function main(): Promise<void> {
  const command = process.argv[2] || 'serve';
  const catalog = new ManifestCatalog(stateDir);
  const cwd = resolve(arg('--cwd', process.cwd()));
  const skillIndexPath = process.argv.includes('--skill-clusters') ? arg('--skill-index', join(HOME, '.agents', 'skill-clusters', 'skill-index.json')) : undefined;
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
    const watcher = new RuntimeWatcher(catalog, { cwd, home: HOME, intervalMs: 1, codegraph: process.argv.includes('--codegraph'), gsd: !process.argv.includes('--no-gsd'), skillIndexPath });
    await watcher.sync();
    watcher.stop();
    console.log(JSON.stringify({ command, project: identity, snapshot: catalog.snapshot(identity.project_id) }, null, 2));
    return;
  }
  if (command === 'codegraph') {
    const identity = readProjectIdentity(cwd) || identityForCwd(cwd);
    catalog.ensureProject(identity);
    const status = readCodeGraphStatus(identity.cwd, { sync: process.argv.includes('--sync') });
    const result = catalog.ingest({
      source: 'codegraph', kind: 'codegraph.status', status: 'observed', actor: 'temperance-manifest',
      project_id: identity.project_id, payload: { ...status, project_name: identity.name, project_cwd: identity.cwd },
      evidence: [{ label: 'codegraph-status', path: identity.cwd }],
    });
    console.log(JSON.stringify({ command, project: identity, status, accepted: result.accepted }, null, 2));
    return;
  }
  if (command === 'omniroute') {
    const identity = readProjectIdentity(cwd) || identityForCwd(cwd);
    catalog.ensureProject(identity);
    const receipt = await manifestRuntimeReceipt({
      bridge_url: 'http://127.0.0.1:1',
      omniroute_url: arg('--omniroute-url', process.env.TEMPERANCE_OMNIROUTE_URL || 'http://127.0.0.1:20128'),
    });
    const result = catalog.ingest({
      source: 'omniroute', kind: 'route.health', status: receipt.omniroute.state === 'ready' ? 'observed' : 'stale', actor: 'temperance-manifest',
      project_id: identity.project_id,
      payload: { ...receipt.omniroute, project_name: identity.name, project_cwd: identity.cwd },
      evidence: [{ label: 'omniroute-health', url: receipt.omniroute.url }],
    });
    console.log(JSON.stringify({ command, project: identity, omniroute: receipt.omniroute, accepted: result.accepted }, null, 2));
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
  const watcher = new RuntimeWatcher(catalog, { cwd, home: HOME, cwds: process.argv.includes('--all') ? registeredCwds : [cwd], codegraph: process.argv.includes('--codegraph'), gsd: !process.argv.includes('--no-gsd'), skillIndexPath });
  const address = await server.listen(port);
  if (!process.argv.includes('--no-watch')) watcher.start();
  const HEARTBEAT_MS = 60_000;
  const emitHeartbeat = (): void => {
    try {
      catalog.ingest({
        source: 'manifest',
        kind: 'bridge.heartbeat',
        status: 'synthetic',
        actor: 'temperance-manifest',
        payload: { interval_ms: HEARTBEAT_MS },
      });
    } catch { /* heartbeat is fail-open */ }
  };
  const heartbeatTimer = setInterval(emitHeartbeat, HEARTBEAT_MS);
  heartbeatTimer.unref();
  console.log(JSON.stringify({ service: 'temperance-manifest-bridge', address: `http://${address.host}:${address.port}`, projects: '/projects', snapshot: '/snapshot?project_id=<id>', events: '/events?project_id=<id>', health: '/health', state_dir: stateDir, cwd, watching: !process.argv.includes('--no-watch'), project_scope: process.argv.includes('--all') ? 'all' : cwd }));
  const shutdown = async () => { clearInterval(heartbeatTimer); watcher.stop(); await server.close(); process.exit(0); };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

await main();
