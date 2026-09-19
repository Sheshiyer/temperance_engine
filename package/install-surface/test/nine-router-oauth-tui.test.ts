import { describe, expect, test } from "bun:test";

import {
  authorizedConnectionIds,
  createNineRouterOAuthInstructions,
} from "../src/onboarding/nine-router-oauth-tui.ts";
import { NINE_ROUTER_PROVIDER_CAPABILITIES } from "../src/onboarding/nine-router-provider-capabilities.ts";

function capability(id: string) {
  return NINE_ROUTER_PROVIDER_CAPABILITIES.find((candidate) => candidate.id === id)!;
}

describe("9router OAuth TUI projection", () => {
  test("renders an explicit authorization callback flow without claiming token custody", () => {
    const view = createNineRouterOAuthInstructions(capability("codex"), {
      kind: "authorization-code",
      provider: "codex",
      authorization_url: "https://auth.example.test/start",
      callback_url: "http://localhost:1455/auth/callback",
    });
    expect(view).toMatchObject({ provider: "codex", flow: "authorization-code" });
    expect(view.body).toContain("Paste the full http://localhost:1455/auth/callback callback URL");
    expect(view.body).toContain("9Router receives and stores the provider tokens");
    expect(view.footer).toContain("enter exchange");
  });

  test("renders manual device polling with the upstream interval and code", () => {
    const view = createNineRouterOAuthInstructions(capability("github"), {
      kind: "device-code",
      provider: "github",
      verification_url: "https://device.example.test/activate",
      user_code: "ABCD-EFGH",
      poll_interval_seconds: 5,
      expires_in_seconds: 300,
    });
    expect(view).toMatchObject({ provider: "github", flow: "device-code", user_code: "ABCD-EFGH" });
    expect(view.body).toContain("press Enter for one bounded status check");
    expect(view.body).toContain("Suggested interval: 5s · expires in 300s");
    expect(view.body).toContain("No automatic polling");
  });

  test("accepts only active-or-unknown matching provider connections as readback authority", () => {
    const catalog = {
      providers: [
        { id: "codex-b", name: "B", provider: "codex", active: null },
        { id: "codex-a", name: "A", provider: "codex", active: true },
        { id: "codex-disabled", name: "Disabled", provider: "codex", active: false },
        { id: "claude-a", name: "Claude", provider: "claude", active: true },
      ],
      combos: [],
    };
    expect(authorizedConnectionIds("codex", catalog)).toEqual(["codex-a", "codex-b"]);
    expect(() => authorizedConnectionIds("github", catalog)).toThrow("NINE_ROUTER_OAUTH_READBACK_MISSING");
  });

  test("rejects a session whose provider differs from the selected capability", () => {
    expect(() => createNineRouterOAuthInstructions(capability("codex"), {
      kind: "authorization-code",
      provider: "claude",
      authorization_url: "https://auth.example.test/start",
      callback_url: "http://localhost:20128/callback",
    })).toThrow("NINE_ROUTER_OAUTH_SESSION_INVALID");
  });
});
