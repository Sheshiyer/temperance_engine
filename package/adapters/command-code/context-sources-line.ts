#!/usr/bin/env bun
// Emits the Command Code pointer catalog and nothing else.
// This adapter performs metadata/path resolution only; it never reads pointer-target bodies.

import type { ResolvedContext } from '../../enrich/contract';
import { resolveContextSources } from '../../enrich/contextSources';
import { contextSources } from '../../enrich/stages/contextSources';

export function renderCommandCodeContextSources(ctx: ResolvedContext): string {
  const result = contextSources(ctx);
  if (!result.line || /[\r\n\u2028\u2029]/u.test(result.line)) {
    throw new Error('command_code_context_sources_contract_failed');
  }
  return result.line;
}

export function generateCommandCodeContextSources(
  cwd: string,
  home = process.env.HOME ?? '',
): string {
  const pointers = resolveContextSources({ home, cwd });
  return renderCommandCodeContextSources({
    input: { prompt: '', cwd, surface: 'command-code' },
    isaPath: null,
    isa: null,
    memory: { worked: null, failed: null, open: null },
    planningPresent: false,
    planningState: null,
    contextSources: pointers,
  });
}

function parseCwd(argv: string[]): string {
  if (argv.length === 0) return process.cwd();
  if (argv.length === 2 && argv[0] === '--cwd' && argv[1]) return argv[1];
  throw new Error('usage');
}

if (import.meta.main) {
  try {
    console.log(generateCommandCodeContextSources(parseCwd(process.argv.slice(2))));
  } catch {
    console.error('Command Code context-source projection failed');
    process.exitCode = 1;
  }
}
