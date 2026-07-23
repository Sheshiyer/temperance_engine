#!/usr/bin/env bun

import manifestJson from "./omniroute-portfolios.json";

export const SHARED_TASK_TYPES = [
  "fast",
  "long-horizon",
  "reasoning",
  "validation",
  "creative",
  "balanced",
] as const;

export type SharedTaskType = (typeof SHARED_TASK_TYPES)[number];
export type PortfolioSource = "portfolio" | "compatibility" | "direct";

export interface PortfolioManifest {
  version: 1;
  compatibility_model: string;
  task_type_portfolios: Record<SharedTaskType, string>;
  reserved_portfolios: string[];
  enforcement: "shadow";
}

export interface PortfolioResolution {
  task_type: SharedTaskType;
  requested_portfolio: string;
  selected_model: string | null;
  source: PortfolioSource;
  enforcement: "shadow";
}

export const portfolioManifest = manifestJson as PortfolioManifest;

function normalizeTaskType(taskType: string): SharedTaskType {
  return (SHARED_TASK_TYPES as readonly string[]).includes(taskType)
    ? (taskType as SharedTaskType)
    : "balanced";
}

export function resolvePortfolio(
  taskType: string,
  availableModels: readonly string[],
  manifest: PortfolioManifest = portfolioManifest,
): PortfolioResolution {
  const normalizedTaskType = normalizeTaskType(taskType);
  const requestedPortfolio = manifest.task_type_portfolios[normalizedTaskType];
  const catalog = new Set(availableModels);

  if (catalog.has(requestedPortfolio)) {
    return {
      task_type: normalizedTaskType,
      requested_portfolio: requestedPortfolio,
      selected_model: requestedPortfolio,
      source: "portfolio",
      enforcement: manifest.enforcement,
    };
  }

  if (catalog.has(manifest.compatibility_model)) {
    return {
      task_type: normalizedTaskType,
      requested_portfolio: requestedPortfolio,
      selected_model: manifest.compatibility_model,
      source: "compatibility",
      enforcement: manifest.enforcement,
    };
  }

  return {
    task_type: normalizedTaskType,
    requested_portfolio: requestedPortfolio,
    selected_model: null,
    source: "direct",
    enforcement: manifest.enforcement,
  };
}

if (import.meta.main) {
  const [command, taskType, ...availableModels] = Bun.argv.slice(2);
  if (command !== "resolve" || !taskType) {
    console.error("usage: omniroute-portfolios.ts resolve TASK_TYPE [MODEL ...]");
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(resolvePortfolio(taskType, availableModels))}\n`);
}
