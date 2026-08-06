/**
 * Gathers real, sourced evidence for one candidate's relocation packet —
 * never a guess. Every field is either sourced (registry, git remote,
 * package.json) or explicitly flagged in `needsReview`. The canonical
 * registry is the primary evidence source (already-verified data from the
 * portfolio classification work), not raw repository re-investigation.
 */

export interface RegistryWorkObject {
  workId: string;
  name: string;
  kind: "sapling" | "program";
  programKind?: "client" | "company" | "capability" | "operations";
  accountId?: string;
  lifecycle?: string;
  sourceRefs: string[];
}

export interface RegistrySourceInventoryEntry {
  path: string;
  workRefs: string[];
}

export interface CanonicalRegistry {
  workObjects: RegistryWorkObject[];
  sourceInventory: RegistrySourceInventoryEntry[];
}

export interface PacketEvidence {
  projectId: string;
  portfolio: "thoughtseed" | "tryambakam-noesis";
  repository: string;
  workObjectId: string;
  workObjectName: string;
  workObjectKind: "sapling" | "program";
  githubIdentity?: string;
  identityStatus: "pending-teamforge-verification" | "unknown";
  knowledgeRef: string;
  knowledgeRefIsPlaceholder: boolean;
  setupCommand: string;
  testCommand: string;
  verifyCommand: string;
  needsReview: string[];
}

export function matchCandidateToWorkObject(
  candidateName: string,
  registry: CanonicalRegistry,
): RegistryWorkObject {
  const matches = registry.sourceInventory.filter(
    (entry) => entry.path.split("/").filter(Boolean).pop() === candidateName,
  );
  if (matches.length === 0) {
    throw new Error(`${candidateName}: no sourceInventory match`);
  }
  if (matches.length > 1) {
    throw new Error(`${candidateName}: multiple sourceInventory matches`);
  }
  const workRefs = matches[0].workRefs;
  if (workRefs.length === 0) {
    throw new Error(`${candidateName}: sourceInventory entry has no workRefs`);
  }
  if (workRefs.length > 1) {
    throw new Error(
      `${candidateName}: sourceInventory entry has multiple workRefs (${workRefs.join(", ")})`,
    );
  }
  const workObject = registry.workObjects.find((entry) => entry.workId === workRefs[0]);
  if (!workObject) {
    throw new Error(`${candidateName}: workRefs[0] "${workRefs[0]}" not found in workObjects`);
  }
  return workObject;
}

function extractGithubIdentity(remoteUrl: string | null): string | undefined {
  if (!remoteUrl) return undefined;
  const match = remoteUrl.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  return match ? match[1] : undefined;
}

function extractKnowledgeRef(sourceRefs: string[]): { value: string; isPlaceholder: boolean } {
  const vaultRef = sourceRefs.find((ref) => ref.startsWith("vault:"));
  if (vaultRef) return { value: vaultRef.slice("vault:".length), isPlaceholder: false };
  return {
    value: "00-meta/system-of-records.md",
    isPlaceholder: true,
  };
}

export type PackageManager = "bun" | "pnpm" | "npm";

function selectCommands(
  packageJsonScripts: Record<string, string> | null,
  packageManager: PackageManager,
  needsReview: string[],
): { setupCommand: string; testCommand: string; verifyCommand: string } {
  if (!packageJsonScripts) {
    needsReview.push("commands.verify");
    return { setupCommand: "not-applicable", testCommand: "not-applicable", verifyCommand: "true" };
  }
  const runner = packageManager;
  const setupCommand = `${packageManager} install`;
  const testCommand = packageJsonScripts.test ? `${runner} run test` : "not-applicable";
  let verifyCommand: string;
  if (packageJsonScripts.build) {
    verifyCommand = `${runner} run build`;
  } else if (packageJsonScripts.test) {
    verifyCommand = `${runner} run test`;
  } else {
    needsReview.push("commands.verify");
    verifyCommand = "true";
  }
  return { setupCommand, testCommand, verifyCommand };
}

export function gatherPacketEvidence(input: {
  candidateName: string;
  portfolio: "thoughtseed" | "tryambakam-noesis";
  registry: CanonicalRegistry;
  gitRemoteUrl: string | null;
  packageJsonScripts: Record<string, string> | null;
  packageManager: PackageManager;
}): PacketEvidence {
  const workObject = matchCandidateToWorkObject(input.candidateName, input.registry);
  const needsReview: string[] = [];

  const githubIdentity = extractGithubIdentity(input.gitRemoteUrl);
  const identityStatus = githubIdentity ? "pending-teamforge-verification" : "unknown";

  const { value: knowledgeRef, isPlaceholder: knowledgeRefIsPlaceholder } = extractKnowledgeRef(
    workObject.sourceRefs,
  );
  if (knowledgeRefIsPlaceholder) needsReview.push("knowledge_ref");

  const { setupCommand, testCommand, verifyCommand } = selectCommands(
    input.packageJsonScripts,
    input.packageManager,
    needsReview,
  );

  return {
    projectId: input.candidateName,
    portfolio: input.portfolio,
    repository: input.candidateName,
    workObjectId: workObject.workId,
    workObjectName: workObject.name,
    workObjectKind: workObject.kind,
    githubIdentity,
    identityStatus,
    knowledgeRef,
    knowledgeRefIsPlaceholder,
    setupCommand,
    testCommand,
    verifyCommand,
    needsReview,
  };
}
