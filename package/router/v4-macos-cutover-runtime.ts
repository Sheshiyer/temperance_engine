import { join } from "node:path";

import type { KeychainSecretReference } from "../install-surface/src/onboarding/contracts.ts";
import { FileV4CutoverJournal } from "./v4-cutover-journal.ts";
import {
  MacOsV4CutoverAdapter,
  type V4MacOsHostIO,
} from "./v4-macos-host-adapter.ts";
import {
  MacOsV4ReplacementServices,
  type MacOsV4DoctorProbe,
  type MacOsV4ReplacementServicesIO,
} from "./v4-macos-replacement-services.ts";
import {
  PortableV4ReplacementLifecycle,
  type PortableV4ReplacementIO,
} from "./v4-portable-replacement.ts";

export interface MacOsV4CutoverRuntimeOptions {
  homeDirectory: string;
  sourceRepository: string;
  envExecutable: string;
  nodeExecutable: string;
  executablePath: string;
  legacyCredentialReferences: Readonly<Record<string, KeychainSecretReference>>;
  doctor: MacOsV4DoctorProbe;
  uid?: number;
  hostIO?: V4MacOsHostIO;
  replacementIO?: PortableV4ReplacementIO;
  servicesIO?: MacOsV4ReplacementServicesIO;
  bunExecutable?: string;
  gitExecutable?: string;
  tarExecutable?: string;
  launchctlExecutable?: string;
  securityExecutable?: string;
  lsofExecutable?: string;
  psExecutable?: string;
}

export interface MacOsV4CutoverRuntimePaths {
  runtime: string;
  router_data: string;
  logs: string;
  launch_agents: string;
  application_support: string;
  staging: string;
  receipts: string;
}

export interface MacOsV4CutoverRuntime {
  paths: Readonly<MacOsV4CutoverRuntimePaths>;
  services: MacOsV4ReplacementServices;
  replacement: PortableV4ReplacementLifecycle;
  adapter: MacOsV4CutoverAdapter;
  journal: FileV4CutoverJournal;
}

/**
 * Pure composition root. Construction allocates no directories, starts no
 * service, reads no secret, and performs no cutover action.
 */
export function createMacOsV4CutoverRuntime(options: MacOsV4CutoverRuntimeOptions): MacOsV4CutoverRuntime {
  const applicationSupport = join(options.homeDirectory, "Library", "Application Support", "Temperance");
  const paths: Readonly<MacOsV4CutoverRuntimePaths> = Object.freeze({
    runtime: join(options.homeDirectory, ".temperance_engine"),
    router_data: join(options.homeDirectory, ".9router"),
    logs: join(options.homeDirectory, ".temperance_engine", "logs"),
    launch_agents: join(options.homeDirectory, "Library", "LaunchAgents"),
    application_support: applicationSupport,
    staging: join(applicationSupport, "staging", "v4-cutover"),
    receipts: join(applicationSupport, "receipts", "v4-cutover"),
  });
  const services = new MacOsV4ReplacementServices({
    launchAgentsDirectory: paths.launch_agents,
    runtimeRoot: paths.runtime,
    dataDirectory: paths.router_data,
    logDirectory: paths.logs,
    envExecutable: options.envExecutable,
    nodeExecutable: options.nodeExecutable,
    executablePath: options.executablePath,
    doctor: options.doctor,
    io: options.servicesIO,
    uid: options.uid,
    launchctlExecutable: options.launchctlExecutable,
    lsofExecutable: options.lsofExecutable,
    psExecutable: options.psExecutable,
  });
  const replacement = new PortableV4ReplacementLifecycle({
    sourceRepository: options.sourceRepository,
    stagingRoot: paths.staging,
    runtimeRoot: paths.runtime,
    dataDirectory: paths.router_data,
    logDirectory: paths.logs,
    nodeExecutable: options.nodeExecutable,
    executablePath: options.executablePath,
    services,
    io: options.replacementIO,
    bunExecutable: options.bunExecutable,
    gitExecutable: options.gitExecutable,
    tarExecutable: options.tarExecutable,
    platform: options.servicesIO?.platform,
  });
  const adapter = new MacOsV4CutoverAdapter({
    homeDirectory: options.homeDirectory,
    launchAgentsDirectory: paths.launch_agents,
    legacyCredentialReferences: options.legacyCredentialReferences,
    replacement,
    io: options.hostIO,
    launchctlExecutable: options.launchctlExecutable,
    securityExecutable: options.securityExecutable,
    uid: options.uid,
  });
  return {
    paths,
    services,
    replacement,
    adapter,
    journal: new FileV4CutoverJournal(paths.receipts),
  };
}
