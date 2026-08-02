#!/usr/bin/env bun

import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  NATIVE_CONTROL_PLANE_SCHEMA,
  NativeControlPlaneError,
  collectNativeControlPlane,
  defaultCliProbe,
  defaultCloudflaredProcessProbe,
  defaultRuntimeProbe,
  resolveInstalledOmniRouteVersion,
} from "../package/router/omniroute-native-control-plane";

function errorResult(code: string): string {
  return JSON.stringify({
    schema: `${NATIVE_CONTROL_PLANE_SCHEMA}.error`,
    mode: "read-only-local-snapshot",
    ok: false,
    promotionAuthorized: false,
    code,
  });
}

export function main(argv: string[] = process.argv.slice(2)): number {
  if (argv.length !== 0) {
    process.stdout.write(`${errorResult("arguments_forbidden")}\n`);
    return 2;
  }
  try {
    const root = resolve(import.meta.dir, "..");
    const omniHome = resolve(homedir(), ".omniroute");
    const snapshot = collectNativeControlPlane({
      databasePath: resolve(omniHome, "storage.sqlite"),
      dispatchManifestPath: resolve(root, "package/router/temperance-workflows.json"),
      installedVersion: resolveInstalledOmniRouteVersion(),
      runtimeProbe: defaultRuntimeProbe,
      cloudflaredProcessProbe: defaultCloudflaredProcessProbe,
      cliProbe: defaultCliProbe,
      quickTunnelStatePath: resolve(omniHome, "cloudflared/quick-tunnel-state.json"),
      hermesDirectoryPath: resolve(homedir(), ".hermes"),
    });
    process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof NativeControlPlaneError ? error.code : "native_snapshot_failed";
    process.stdout.write(`${errorResult(code)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = main();
