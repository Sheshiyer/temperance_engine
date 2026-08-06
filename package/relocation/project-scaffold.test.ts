import { describe, expect, test } from "bun:test";

import { synthesizeScaffoldEvidence } from "./project-scaffold";
import { renderPacket } from "./packet-draft";
import { parseFlatProjectYaml } from "./project-packet";
import { validateProjectYaml } from "./project-packet-schema";

const INPUT = {
  projectId: "client-x",
  portfolio: "thoughtseed" as const,
  repository: "client-x",
  workObjectId: "sapling:client-x",
  workObjectName: "Client X",
  workObjectKind: "sapling" as const,
};

describe("synthesizeScaffoldEvidence", () => {
  test("carries the caller-supplied identity fields through unchanged", () => {
    const evidence = synthesizeScaffoldEvidence(INPUT);
    expect(evidence.projectId).toBe("client-x");
    expect(evidence.portfolio).toBe("thoughtseed");
    expect(evidence.repository).toBe("client-x");
    expect(evidence.workObjectId).toBe("sapling:client-x");
    expect(evidence.workObjectName).toBe("Client X");
    expect(evidence.workObjectKind).toBe("sapling");
    expect(evidence.githubIdentity).toBeUndefined();
  });

  test("starts identityStatus pending-teamforge-verification, since nothing has been verified yet", () => {
    const evidence = synthesizeScaffoldEvidence(INPUT);
    expect(evidence.identityStatus).toBe("pending-teamforge-verification");
  });

  test("flags knowledge_ref and every command as needing review, never fabricating a value", () => {
    const evidence = synthesizeScaffoldEvidence(INPUT);
    expect(evidence.knowledgeRefIsPlaceholder).toBe(true);
    expect(evidence.needsReview).toEqual([
      "knowledge_ref",
      "commands.setup",
      "commands.test",
      "commands.verify",
    ]);
  });

  test("verifyCommand defaults to the true no-op, never the rejected not-applicable literal", () => {
    const evidence = synthesizeScaffoldEvidence(INPUT);
    expect(evidence.verifyCommand).toBe("true");
    expect(evidence.setupCommand).toBe("not-applicable");
    expect(evidence.testCommand).toBe("not-applicable");
  });

  test("renderPacket output validates against the real, unmodified packet schema", () => {
    const evidence = synthesizeScaffoldEvidence(INPUT);
    const files = renderPacket(evidence);
    const parsed = parseFlatProjectYaml(files[".project/project.yaml"]);
    const result = validateProjectYaml(parsed, { approvedLanes: ["te-plan", "te-review"] });
    expect(result.valid).toBe(true);
  });
});
