import { expect, test } from "bun:test";

import { hostIdentityMatches } from "../src/onboarding/host-identity.ts";

const intended = {
  platform: "darwin" as const,
  hardware_model: "Mac16,11",
  chip_model: "Apple M4",
  architecture: "arm64",
  user_id: 501,
};

test("private intended-host identity requires an exact machine match", () => {
  expect(hostIdentityMatches(intended, { ...intended })).toBe(true);
  expect(hostIdentityMatches(intended, { ...intended, hardware_model: "Mac15,12", chip_model: "Apple M3" })).toBe(false);
  expect(hostIdentityMatches(intended, { ...intended, user_id: 502 })).toBe(false);
});
