#!/usr/bin/env bun
import { classifyTask } from "./task-classification";

// Preserve the shell CLI's first-argument contract, including literal options.
// Importing this adapter must not read argv or produce output.
if (import.meta.main) {
  const { taskType, preferred } = classifyTask(process.argv[2] ?? "");
  process.stdout.write(`${taskType}\t${preferred}\n`);
}
