import { runNineRouterOAuthTui, type NineRouterOAuthTuiApi } from "../../src/onboarding/nine-router-oauth-tui.ts";

const authorizationFlow = process.argv.includes("--authorization");
const providerId = authorizationFlow ? "codex" : "github";
const api: NineRouterOAuthTuiApi = {
  beginOAuthAuthorization: async (provider) => ({
    kind: "authorization-code",
    provider,
    authorization_url: "https://example.invalid/authorize",
    callback_url: "http://localhost:1455/auth/callback",
  }),
  completeOAuthAuthorization: async (session, callbackUrl) => {
    if (session.provider !== "codex" || callbackUrl !== "http://localhost:1455/auth/callback?code=fixture&state=fixture") {
      throw new Error("FIXTURE_CALLBACK_MISMATCH");
    }
    return { provider: session.provider, connected: true };
  },
  beginOAuthDevice: async (provider) => ({
    kind: "device-code",
    provider,
    verification_url: "https://example.invalid/device",
    user_code: "FIXTURE-CODE",
    poll_interval_seconds: 1,
    expires_in_seconds: 300,
  }),
  pollOAuthDevice: async (session) => ({ status: "connected", provider: session.provider }),
  readCatalog: async () => ({
    providers: [{ id: "fixture-connection", name: "Fixture", provider: providerId, active: true }],
    combos: [],
  }),
};

const result = await runNineRouterOAuthTui({
  providerId,
  api,
  now: () => new Date("2026-09-17T00:00:00.000Z"),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
