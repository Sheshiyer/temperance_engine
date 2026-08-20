#!/usr/bin/env bun

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const routerDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(routerDir);
const bridgeCli = join(repoRoot, 'manifest-bridge', 'src', 'cli.ts');
const args = process.argv.slice(2);
const child = Bun.spawn(['bun', 'run', bridgeCli, ...args], { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
process.exit(await child.exited);
