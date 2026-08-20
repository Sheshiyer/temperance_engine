import { execFileSync } from 'node:child_process';

export interface CodeGraphStatus {
  status: 'ready' | 'unavailable' | 'uninitialized' | 'failed';
  available: boolean;
  project_path: string;
  indexed_files: number | null;
  nodes: number | null;
  edges: number | null;
  database_size_bytes: number | null;
  backend?: string;
  sync_requested: boolean;
  reason?: string;
}

interface CodeGraphRawStatus {
  initialized?: boolean;
  projectPath?: string;
  fileCount?: number;
  nodeCount?: number;
  edgeCount?: number;
  dbSizeBytes?: number;
  backend?: string;
}

export interface CodeGraphOptions {
  runner?: (projectPath: string, sync: boolean) => string;
  sync?: boolean;
}

function readStatus(projectPath: string, sync: boolean, runner: (projectPath: string, sync: boolean) => string): CodeGraphStatus {
  try {
    const raw = JSON.parse(runner(projectPath, sync)) as CodeGraphRawStatus;
    if (!raw || typeof raw !== 'object') throw new Error('invalid CodeGraph status');
    const initialized = raw.initialized === true;
    return {
      status: initialized ? 'ready' : 'uninitialized',
      available: initialized,
      project_path: projectPath,
      indexed_files: typeof raw.fileCount === 'number' ? raw.fileCount : null,
      nodes: typeof raw.nodeCount === 'number' ? raw.nodeCount : null,
      edges: typeof raw.edgeCount === 'number' ? raw.edgeCount : null,
      database_size_bytes: typeof raw.dbSizeBytes === 'number' ? raw.dbSizeBytes : null,
      backend: typeof raw.backend === 'string' ? raw.backend : undefined,
      sync_requested: sync,
      ...(initialized ? {} : { reason: 'CodeGraph is not initialized for this project.' }),
    };
  } catch (error) {
    return {
      status: 'unavailable', available: false, project_path: projectPath,
      indexed_files: null, nodes: null, edges: null, database_size_bytes: null,
      sync_requested: sync,
      reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    };
  }
}

export function readCodeGraphStatus(projectPath: string, options: CodeGraphOptions = {}): CodeGraphStatus {
  const sync = options.sync === true;
  const runner = options.runner || ((path: string, shouldSync: boolean) => {
    if (shouldSync) execFileSync('codegraph', ['sync', path, '--quiet'], { stdio: 'ignore', timeout: 15_000 });
    return execFileSync('codegraph', ['status', '--json', path], { encoding: 'utf8', timeout: 5_000 });
  });
  return readStatus(projectPath, sync, runner);
}
