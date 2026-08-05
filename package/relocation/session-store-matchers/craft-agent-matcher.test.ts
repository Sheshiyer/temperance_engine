// package/relocation/session-store-matchers/craft-agent-matcher.test.ts
import { describe, expect, test } from "bun:test";

import { matchCraftAgent } from "./craft-agent-matcher";

describe("matchCraftAgent", () => {
  test("always reports unsupported — no per-project convention was found (Design §4/§5)", () => {
    const result = matchCraftAgent("/Volumes/fixture/thoughtseed/some-repo");

    expect(result).toEqual({ tool: "craft-agent", mechanism: "unsupported", matched: null });
  });
});
