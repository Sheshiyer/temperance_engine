import {
  BoxRenderable,
  CliRenderEvents,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  createCliRenderer,
} from "@opentui/core";

import type {
  NineRouterApiClient,
  NineRouterCatalogSnapshot,
  NineRouterOAuthAuthorizationSession,
  NineRouterOAuthDeviceSession,
} from "./nine-router-api.ts";
import {
  NINE_ROUTER_PROVIDER_CAPABILITIES,
  type NineRouterProviderCapability,
} from "./nine-router-provider-capabilities.ts";

export type NineRouterOAuthTuiApi = Pick<
  NineRouterApiClient,
  | "beginOAuthAuthorization"
  | "completeOAuthAuthorization"
  | "beginOAuthDevice"
  | "pollOAuthDevice"
  | "readCatalog"
>;

export interface NineRouterOAuthTuiOptions {
  providerId: string;
  api: NineRouterOAuthTuiApi;
  now?: () => Date;
  nowMilliseconds?: () => number;
}

export interface NineRouterOAuthTuiResult {
  provider: string;
  connected: boolean;
  connected_at?: string;
  connection_ids: string[];
}

export interface NineRouterOAuthInstructions {
  provider: string;
  title: string;
  flow: "authorization-code" | "device-code";
  url: string;
  user_code?: string;
  body: string;
  footer: string;
}

function oauthCapability(providerId: string): NineRouterProviderCapability {
  const capability = NINE_ROUTER_PROVIDER_CAPABILITIES.find(({ id }) => id === providerId);
  if (!capability || capability.auth_kind === "api-key") throw new Error("NINE_ROUTER_OAUTH_PROVIDER_INVALID");
  return capability;
}

export function createNineRouterOAuthInstructions(
  capability: NineRouterProviderCapability,
  session: NineRouterOAuthAuthorizationSession | NineRouterOAuthDeviceSession,
): NineRouterOAuthInstructions {
  if (capability.id !== session.provider) throw new Error("NINE_ROUTER_OAUTH_SESSION_INVALID");
  if (session.kind === "authorization-code") return {
    provider: capability.id,
    title: `${capability.display_name} · authorization code`,
    flow: session.kind,
    url: session.authorization_url,
    body: [
      "1. Open the authorization URL manually in your browser.",
      "2. Complete provider authorization.",
      `3. Paste the full ${session.callback_url} callback URL below.`,
      "",
      "Temperance keeps the verifier and CSRF proof only in this process.",
      "9Router receives and stores the provider tokens.",
    ].join("\n"),
    footer: "paste callback URL · enter exchange · esc cancel",
  };
  return {
    provider: capability.id,
    title: `${capability.display_name} · device code`,
    flow: session.kind,
    url: session.verification_url,
    ...(session.user_code ? { user_code: session.user_code } : {}),
    body: [
      "1. Open the verification URL manually in your browser.",
      ...(session.user_code ? [`2. Enter code: ${session.user_code}`] : ["2. Complete the provider prompt."]),
      "3. Return here and press p for one bounded status check.",
      "",
      `Suggested interval: ${session.poll_interval_seconds}s${session.expires_in_seconds ? ` · expires in ${session.expires_in_seconds}s` : ""}.`,
      "No automatic polling, browser launch, or clipboard write occurs.",
    ].join("\n"),
    footer: "p poll once · q/esc cancel",
  };
}

export function authorizedConnectionIds(provider: string, catalog: NineRouterCatalogSnapshot): string[] {
  const ids = catalog.providers
    .filter((connection) => connection.provider === provider && connection.active !== false)
    .map(({ id }) => id)
    .sort();
  if (ids.length === 0) throw new Error("NINE_ROUTER_OAUTH_READBACK_MISSING");
  return ids;
}

/**
 * Runs only after an explicit provider action in onboarding. It never opens a
 * browser, writes the clipboard, auto-polls, or returns interaction secrets.
 */
export async function runNineRouterOAuthTui(options: NineRouterOAuthTuiOptions): Promise<NineRouterOAuthTuiResult> {
  const capability = oauthCapability(options.providerId);
  const session = capability.auth_kind === "oauth-authorization-code"
    ? await options.api.beginOAuthAuthorization(capability.id)
    : await options.api.beginOAuthDevice(capability.id);
  const instructions = createNineRouterOAuthInstructions(capability, session);
  const renderer = await createCliRenderer({ exitOnCtrlC: true, clearOnShutdown: true, useMouse: true });
  const root = new BoxRenderable(renderer, {
    id: "9router-oauth-root", width: "100%", height: "100%", flexDirection: "column",
    backgroundColor: "#0b1020", padding: 1, gap: 1,
  });
  const header = new BoxRenderable(renderer, {
    width: "100%", height: 5, border: true, borderStyle: "rounded", borderColor: "#88c0d0",
    title: "9Router provider authorization", paddingX: 1,
  });
  header.add(new TextRenderable(renderer, {
    content: `${instructions.title}\n9Router owns provider credentials · Temperance owns only this bounded interaction`,
    fg: "#d8dee9",
  }));
  const instructionBox = new BoxRenderable(renderer, {
    width: "100%", flexGrow: 1, border: true, borderStyle: "single", borderColor: "#4c566a",
    title: "Explicit operator steps", padding: 1,
  });
  const detail = new TextRenderable(renderer, {
    content: `${instructions.body}\n\nURL:\n${instructions.url}`,
    fg: "#d8dee9",
  });
  instructionBox.add(detail);
  const inputBox = new BoxRenderable(renderer, {
    width: "100%", height: session.kind === "authorization-code" ? 3 : 0,
    border: session.kind === "authorization-code", borderStyle: "single", borderColor: "#4c566a",
    title: session.kind === "authorization-code" ? "Full callback URL" : undefined,
    paddingX: session.kind === "authorization-code" ? 1 : 0,
  });
  const callbackInput = session.kind === "authorization-code"
    ? new InputRenderable(renderer, {
      width: "100%", value: "", minLength: 1, maxLength: 32_768,
      placeholder: session.callback_url, textColor: "#d8dee9", focusedTextColor: "#ffffff",
      backgroundColor: "#111827", focusedBackgroundColor: "#1f2937",
    })
    : undefined;
  if (callbackInput) inputBox.add(callbackInput);
  const footer = new TextRenderable(renderer, { height: 1, content: instructions.footer, fg: "#88c0d0" });
  root.add(header); root.add(instructionBox);
  if (callbackInput) root.add(inputBox);
  root.add(footer); renderer.root.add(root);
  if (callbackInput) callbackInput.focus();
  renderer.start();

  let busy = false;
  let finished = false;
  let connected = false;
  let failed = false;
  let connectedAt: string | undefined;
  let connectionIds: string[] = [];
  let nextPollAt = 0;

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finish = (): void => {
      if (resolved) return;
      resolved = true;
      finished = true;
      renderer.destroy();
      resolve();
    };
    const commitReadback = async (): Promise<void> => {
      const ids = authorizedConnectionIds(capability.id, await options.api.readCatalog());
      if (finished) return;
      connectionIds = ids;
      connected = true;
      connectedAt = (options.now?.() ?? new Date()).toISOString();
      detail.content = `${capability.display_name}\n\nCONNECTED by 9Router readback.\nConnection IDs: ${connectionIds.join(", ")}\n\nNo provider credential entered Temperance state.`;
      footer.content = "connected · enter/c return to onboarding";
      callbackInput?.blur();
    };
    const fail = (error: unknown): void => {
      if (finished) return;
      failed = true;
      detail.content = `${capability.display_name}\n\nAuthorization stopped safely: ${error instanceof Error ? error.message : "NINE_ROUTER_OAUTH_FAILED"}.\n\nNo proof was persisted. Return to onboarding and restart the flow.`;
      footer.content = "q/esc return to onboarding";
      callbackInput?.blur();
    };
    const exchange = (): void => {
      if (!callbackInput || session.kind !== "authorization-code" || busy || connected) return;
      busy = true;
      callbackInput.blur();
      detail.content = `${instructions.body}\n\nExchanging the validated callback through 9Router…`;
      footer.content = "exchange in progress";
      void options.api.completeOAuthAuthorization(session, callbackInput.value)
        .then(commitReadback)
        .catch(fail)
        .finally(() => { busy = false; });
    };
    callbackInput?.on(InputRenderableEvents.ENTER, exchange);
    renderer.once(CliRenderEvents.DESTROY, () => {
      if (resolved) return;
      resolved = true;
      finished = true;
      resolve();
    });
    renderer.keyInput.on("keypress", (key) => {
      if (finished || busy) return;
      if ((connected || failed) && (key.name === "enter" || key.name === "c" || key.name === "q" || key.name === "escape")) {
        finish();
        return;
      }
      if (key.name === "escape" || (!callbackInput && key.name === "q")) {
        finish();
        return;
      }
      if (session.kind === "device-code" && key.name === "p") {
        const now = options.nowMilliseconds?.() ?? Date.now();
        if (now < nextPollAt) {
          footer.content = `next bounded poll available in ${Math.ceil((nextPollAt - now) / 1000)}s · q/esc cancel`;
          return;
        }
        busy = true;
        footer.content = "one 9Router status check in progress";
        void options.api.pollOAuthDevice(session).then(async (poll) => {
          if (poll.status === "connected") {
            await commitReadback();
            return;
          }
          nextPollAt = (options.nowMilliseconds?.() ?? Date.now()) + (poll.retry_after_seconds * 1000);
          detail.content = `${instructions.body}\n\nPENDING · 9Router has not received provider approval yet.`;
          footer.content = `pending · wait ${poll.retry_after_seconds}s before p · q/esc cancel`;
        }).catch(fail).finally(() => { busy = false; });
      }
    });
  });

  return {
    provider: capability.id,
    connected,
    ...(connectedAt ? { connected_at: connectedAt } : {}),
    connection_ids: connectionIds,
  };
}
