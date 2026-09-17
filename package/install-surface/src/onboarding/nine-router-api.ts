import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";

import {
  NINE_ROUTER_PROVIDER_CAPABILITIES,
  type NineRouterProviderAuthKind,
} from "./nine-router-provider-capabilities.ts";

const MAX_RESPONSE_BYTES = 4_194_304;
const MAX_REQUEST_BYTES = 1_048_576;
const CLI_TOKEN_SALT = "9r-cli-auth";
const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOOLS = new Set(["claude", "codex", "droid", "openclaw"]);

export type NineRouterCliTool = "claude" | "codex" | "droid" | "openclaw";
export interface NineRouterProviderSummary { id: string; name: string; provider: string; active: boolean | null; }
export interface NineRouterComboSummary { id: string; alias: string; model_count: number; }
export interface NineRouterComboDetail { id: string; alias: string; models: string[]; }
export interface NineRouterAvailableModel { id: string; owner: string; kind: "provider" | "combo"; }
export interface NineRouterCatalogSnapshot { providers: NineRouterProviderSummary[]; combos: NineRouterComboSummary[]; }
export interface NineRouterCreatedObject { id: string; name: string; }
export interface NineRouterGatewayKeySummary { id: string; name: string; }
export interface NineRouterGatewayKeyReceipt { id: string; name: string; captured: true; }
export interface NineRouterOAuthConnectionReceipt { provider: string; connected: true; }
export interface NineRouterOAuthAuthorizationSession {
  kind: "authorization-code";
  provider: string;
  authorization_url: string;
  callback_url: string;
}
export interface NineRouterOAuthDeviceSession {
  kind: "device-code";
  provider: string;
  verification_url: string;
  user_code?: string;
  poll_interval_seconds: number;
  expires_in_seconds: number | null;
}
export type NineRouterOAuthDevicePoll =
  | { status: "pending"; retry_after_seconds: number }
  | { status: "connected"; provider: string };

export interface NineRouterApiIO {
  readFile(path: string): Promise<string>;
  mode(path: string): Promise<number>;
  fetch(url: string, init: RequestInit): Promise<Response>;
}

const nodeNineRouterApiIO: NineRouterApiIO = {
  readFile: (path) => readFile(path, "utf8"),
  mode: async (path) => (await stat(path)).mode & 0o777,
  fetch: (url, init) => fetch(url, init),
};

interface AuthorizationSessionSecret {
  codeVerifier: string;
  redirectUri: string;
  state: string;
}

interface DeviceSessionSecret {
  codeVerifier?: string;
  deviceCode: string;
  extraData: unknown;
  pollIntervalSeconds: number;
}

const authorizationSessionSecrets = new WeakMap<NineRouterOAuthAuthorizationSession, AuthorizationSessionSecret>();
const deviceSessionSecrets = new WeakMap<NineRouterOAuthDeviceSession, DeviceSessionSecret>();

export class NineRouterApiError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "NineRouterApiError";
  }
}

function canonicalAbsolute(value: string): boolean {
  return value.length > 1 && isAbsolute(value) && normalize(value) === value && !value.includes("\0");
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new NineRouterApiError("NINE_ROUTER_BASE_URL_INVALID"); }
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  if (url.protocol !== "http:" || !["127.0.0.1", "::1", "localhost"].includes(host)) {
    throw new NineRouterApiError("NINE_ROUTER_BASE_URL_NOT_LOOPBACK");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new NineRouterApiError("NINE_ROUTER_BASE_URL_INVALID");
  }
  if ((url.port || "80") !== "20128") throw new NineRouterApiError("NINE_ROUTER_BASE_URL_PORT_INVALID");
  return `${url.protocol}//${url.host}`;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new NineRouterApiError(code);
  return value as Record<string, unknown>;
}

function textField(value: unknown, code: string, maxLength = 256): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > maxLength || value.includes("\0")) {
    throw new NineRouterApiError(code);
  }
  return value;
}

function modelId(value: unknown, code: string): string {
  const id = textField(value, code, 512);
  if (/[\u0000-\u001f\u007f]/u.test(id)) throw new NineRouterApiError(code);
  return id;
}

function responseArray(value: unknown, field: string): unknown[] {
  const root = record(value, "NINE_ROUTER_RESPONSE_INVALID");
  const direct = root[field];
  if (Array.isArray(direct)) return direct;
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data as Record<string, unknown> : undefined;
  if (Array.isArray(data?.[field])) return data[field] as unknown[];
  throw new NineRouterApiError("NINE_ROUTER_RESPONSE_INVALID");
}

function createdRecord(value: unknown, nested: string): Record<string, unknown> {
  const root = record(value, "NINE_ROUTER_RESPONSE_INVALID");
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data as Record<string, unknown> : root;
  const candidate = data[nested];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : data;
}

function safeId(value: unknown): string {
  const id = textField(value, "NINE_ROUTER_RESPONSE_INVALID", 512);
  if (!/^[A-Za-z0-9._-]+$/u.test(id)) throw new NineRouterApiError("NINE_ROUTER_RESPONSE_INVALID");
  return id;
}

function oauthCapability(provider: string, expected?: NineRouterProviderAuthKind): string {
  const id = textField(provider, "NINE_ROUTER_OAUTH_PROVIDER_INVALID", 128);
  const capability = NINE_ROUTER_PROVIDER_CAPABILITIES.find((candidate) => candidate.id === id);
  if (!capability || capability.auth_kind === "api-key") {
    throw new NineRouterApiError("NINE_ROUTER_OAUTH_PROVIDER_INVALID");
  }
  if (expected && capability.auth_kind !== expected) {
    throw new NineRouterApiError("NINE_ROUTER_OAUTH_FLOW_INVALID");
  }
  return capability.id;
}

function oauthRedirectUri(provider: string): string {
  return provider === "codex"
    ? "http://localhost:1455/auth/callback"
    : "http://localhost:20128/callback";
}

function exactEndpoint(path: string): URL | undefined {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("#") || /[\u0000-\u001f\u007f]/u.test(path)) return undefined;
  let parsed: URL;
  try { parsed = new URL(path, "http://temperance.invalid"); } catch { return undefined; }
  if (parsed.origin !== "http://temperance.invalid" || `${parsed.pathname}${parsed.search}` !== path) return undefined;
  return parsed;
}

function endpointAllowed(method: string, path: string): boolean {
  const endpoint = exactEndpoint(path);
  if (!endpoint) return false;
  const pathname = endpoint.pathname;
  if (method === "GET" && ["/api/providers", "/api/combos", "/api/keys", "/v1/models"].includes(pathname) && !endpoint.search) return true;
  if (method === "GET" && /^\/api\/combos\/[A-Za-z0-9._-]{1,512}$/u.test(pathname) && !endpoint.search) return true;
  if ((method === "GET" || method === "POST") && /^\/api\/cli-tools\/(claude|codex|droid|openclaw)-settings$/u.test(pathname) && !endpoint.search) return true;
  if (method === "POST" && ["/api/providers", "/api/combos", "/api/keys"].includes(pathname) && !endpoint.search) return true;
  if (method === "DELETE" && /^\/api\/(?:providers|combos|keys)\/[A-Za-z0-9._-]{1,512}$/u.test(pathname) && !endpoint.search) return true;

  const match = pathname.match(/^\/api\/oauth\/([A-Za-z0-9-]{1,128})\/(authorize|exchange|device-code|poll)$/u);
  if (!match) return false;
  const [, provider = "", action = ""] = match;
  const capability = NINE_ROUTER_PROVIDER_CAPABILITIES.find((candidate) => candidate.id === provider);
  if (!capability || capability.auth_kind === "api-key") return false;
  const authKind: NineRouterProviderAuthKind = capability.auth_kind;
  if (authKind === "oauth-authorization-code") {
    if (action === "exchange") return method === "POST" && !endpoint.search;
    if (action !== "authorize" || method !== "GET") return false;
    const keys = [...endpoint.searchParams.keys()];
    return keys.length === 1
      && keys[0] === "redirect_uri"
      && endpoint.searchParams.getAll("redirect_uri").length === 1
      && endpoint.searchParams.get("redirect_uri") === oauthRedirectUri(provider);
  }
  return !endpoint.search && ((action === "device-code" && method === "GET") || (action === "poll" && method === "POST"));
}

function responseRecord(value: unknown): Record<string, unknown> {
  const root = record(value, "NINE_ROUTER_RESPONSE_INVALID");
  return root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : root;
}

function externalHttpsUrl(value: unknown, code: string): string {
  const source = textField(value, code, 32_768);
  let url: URL;
  try { url = new URL(source); } catch { throw new NineRouterApiError(code); }
  if (url.protocol !== "https:" || url.username || url.password || /[\u0000-\u001f\u007f]/u.test(source)) {
    throw new NineRouterApiError(code);
  }
  return source;
}

function boundedJsonClone(value: unknown): unknown {
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new NineRouterApiError("NINE_ROUTER_RESPONSE_INVALID"); }
  if (!encoded || Buffer.byteLength(encoded, "utf8") > MAX_REQUEST_BYTES) {
    throw new NineRouterApiError("NINE_ROUTER_RESPONSE_INVALID");
  }
  return JSON.parse(encoded) as unknown;
}

function boundedSeconds(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : fallback;
}

function freezeOpaqueSession<T extends { kind: string; provider: string }>(session: T): T {
  Object.defineProperty(session, "toJSON", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: () => ({ kind: session.kind, provider: session.provider, opaque: true }),
  });
  return Object.freeze(session);
}

function authorizationCallback(value: string, secret: AuthorizationSessionSecret): string {
  const source = textField(value, "NINE_ROUTER_OAUTH_CALLBACK_INVALID", 32_768);
  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(source);
    expected = new URL(secret.redirectUri);
  } catch {
    throw new NineRouterApiError("NINE_ROUTER_OAUTH_CALLBACK_INVALID");
  }
  if (
    actual.username
    || actual.password
    || actual.hash
    || actual.protocol !== expected.protocol
    || actual.hostname !== expected.hostname
    || actual.port !== expected.port
    || actual.pathname !== expected.pathname
  ) {
    throw new NineRouterApiError("NINE_ROUTER_OAUTH_CALLBACK_INVALID");
  }
  if (actual.searchParams.has("error")) throw new NineRouterApiError("NINE_ROUTER_OAUTH_PROVIDER_DENIED");
  const codes = actual.searchParams.getAll("code");
  const states = actual.searchParams.getAll("state");
  if (codes.length !== 1 || states.length !== 1 || states[0] !== secret.state) {
    throw new NineRouterApiError("NINE_ROUTER_OAUTH_CALLBACK_INVALID");
  }
  return textField(codes[0], "NINE_ROUTER_OAUTH_CALLBACK_INVALID", 16_384);
}

function redactCredentialFields(value: unknown, depth = 0): unknown {
  if (depth > 16) throw new NineRouterApiError("NINE_ROUTER_RESPONSE_INVALID");
  if (Array.isArray(value)) return value.map((item) => redactCredentialFields(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const blocked = /(?:api.?key|authorization|credential|password|secret|token)/iu;
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => !blocked.test(key))
    .map(([key, item]) => [key, redactCredentialFields(item, depth + 1)]));
}

function secretFreeObject(value: unknown): Record<string, unknown> {
  return record(redactCredentialFields(value), "NINE_ROUTER_RESPONSE_INVALID");
}

function assertNoCredentialFields(value: unknown, depth = 0): void {
  if (depth > 16) throw new NineRouterApiError("NINE_ROUTER_REQUEST_INVALID");
  if (Array.isArray(value)) {
    for (const item of value) assertNoCredentialFields(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:api.?key|authorization|credential|password|secret|token)/iu.test(key)) {
      throw new NineRouterApiError("NINE_ROUTER_REQUEST_SECRET_FIELD_FORBIDDEN");
    }
    assertNoCredentialFields(item, depth + 1);
  }
}

export class NineRouterApiClient {
  private readonly dataDirectory: string;
  private readonly baseUrl: string;
  private readonly io: NineRouterApiIO;

  constructor(options: { dataDirectory: string; baseUrl?: string; io?: NineRouterApiIO }) {
    if (!canonicalAbsolute(options.dataDirectory)) throw new NineRouterApiError("NINE_ROUTER_DATA_DIR_INVALID");
    this.dataDirectory = options.dataDirectory;
    this.baseUrl = validateBaseUrl(options.baseUrl ?? "http://127.0.0.1:20128");
    this.io = options.io ?? nodeNineRouterApiIO;
  }

  private async deriveCliToken(): Promise<string> {
    const secretPath = join(this.dataDirectory, "auth", "cli-secret");
    let machineId: string;
    let secret: string;
    try {
      [machineId, secret] = await Promise.all([
        this.io.readFile(join(this.dataDirectory, "machine-id")),
        this.io.readFile(secretPath),
      ]);
    } catch {
      throw new NineRouterApiError("NINE_ROUTER_AUTH_METADATA_MISSING");
    }
    if ((await this.io.mode(secretPath)) !== 0o600) throw new NineRouterApiError("NINE_ROUTER_CLI_SECRET_MODE_UNSAFE");
    machineId = machineId.trim();
    secret = secret.trim();
    if (!machineId || !secret || machineId.length > 4096 || secret.length > 4096) {
      throw new NineRouterApiError("NINE_ROUTER_AUTH_METADATA_INVALID");
    }
    return createHash("sha256").update(machineId + CLI_TOKEN_SALT + secret).digest("hex").slice(0, 16);
  }

  private async request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<unknown> {
    if (!endpointAllowed(method, path)) throw new NineRouterApiError("NINE_ROUTER_ENDPOINT_NOT_ALLOWED");
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    if (encoded !== undefined && Buffer.byteLength(encoded, "utf8") > MAX_REQUEST_BYTES) {
      throw new NineRouterApiError("NINE_ROUTER_REQUEST_TOO_LARGE");
    }
    const token = await this.deriveCliToken();
    let response: Response;
    try {
      response = await this.io.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json", [CLI_TOKEN_HEADER]: token },
        body: encoded,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new NineRouterApiError("NINE_ROUTER_API_UNAVAILABLE");
    }
    const length = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new NineRouterApiError("NINE_ROUTER_RESPONSE_TOO_LARGE");
    const responseText = await response.text();
    if (Buffer.byteLength(responseText, "utf8") > MAX_RESPONSE_BYTES) throw new NineRouterApiError("NINE_ROUTER_RESPONSE_TOO_LARGE");
    if (!response.ok) throw new NineRouterApiError(`NINE_ROUTER_API_HTTP_${response.status}`);
    try { return responseText ? JSON.parse(responseText) : {}; } catch { throw new NineRouterApiError("NINE_ROUTER_RESPONSE_INVALID"); }
  }

  async readCatalog(): Promise<NineRouterCatalogSnapshot> {
    const [providerResponse, comboResponse] = await Promise.all([
      this.request("GET", "/api/providers"),
      this.request("GET", "/api/combos"),
    ]);
    const providers = responseArray(providerResponse, "connections").map((value): NineRouterProviderSummary => {
      const item = record(value, "NINE_ROUTER_RESPONSE_INVALID");
      return {
        id: safeId(item.id),
        name: textField(item.name, "NINE_ROUTER_RESPONSE_INVALID"),
        provider: textField(item.provider, "NINE_ROUTER_RESPONSE_INVALID"),
        active: typeof item.isActive === "boolean" ? item.isActive : typeof item.is_active === "boolean" ? item.is_active : null,
      };
    });
    const combos = responseArray(comboResponse, "combos").map((value): NineRouterComboSummary => {
      const item = record(value, "NINE_ROUTER_RESPONSE_INVALID");
      const models = Array.isArray(item.models) ? item.models : [];
      return { id: safeId(item.id), alias: textField(item.name, "NINE_ROUTER_RESPONSE_INVALID"), model_count: models.length };
    });
    return { providers, combos };
  }

  /**
   * Reads 9Router's OpenAI-compatible catalog after provider admission.
   * This is the authoritative dropdown surface: the adapter deliberately does
   * not copy 9Router's private provider/model registry into Temperance policy.
   */
  async readAvailableModels(): Promise<NineRouterAvailableModel[]> {
    return responseArray(await this.request("GET", "/v1/models"), "data")
      .map((value): NineRouterAvailableModel => {
        const item = record(value, "NINE_ROUTER_RESPONSE_INVALID");
        const id = modelId(item.id, "NINE_ROUTER_RESPONSE_INVALID");
        const owner = textField(item.owned_by, "NINE_ROUTER_RESPONSE_INVALID", 256);
        if (/[\u0000-\u001f\u007f]/u.test(id) || /[\u0000-\u001f\u007f]/u.test(owner)) {
          throw new NineRouterApiError("NINE_ROUTER_RESPONSE_INVALID");
        }
        return { id, owner, kind: owner === "combo" ? "combo" : "provider" };
      })
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.owner.localeCompare(right.owner) || left.id.localeCompare(right.id));
  }

  /**
   * Starts an authorization-code flow owned by 9Router. The verifier and CSRF
   * state live only in this module's WeakMap and cannot be serialized with the
   * user-facing session object.
   */
  async beginOAuthAuthorization(providerInput: string): Promise<NineRouterOAuthAuthorizationSession> {
    const provider = oauthCapability(providerInput, "oauth-authorization-code");
    const expectedRedirectUri = oauthRedirectUri(provider);
    const path = `/api/oauth/${provider}/authorize?redirect_uri=${encodeURIComponent(expectedRedirectUri)}`;
    const value = responseRecord(await this.request("GET", path));
    const authorizationUrl = externalHttpsUrl(value.authUrl, "NINE_ROUTER_OAUTH_AUTHORIZATION_URL_INVALID");
    const codeVerifier = textField(value.codeVerifier, "NINE_ROUTER_RESPONSE_INVALID", 16_384);
    const state = textField(value.state, "NINE_ROUTER_RESPONSE_INVALID", 16_384);
    const redirectUri = textField(value.redirectUri, "NINE_ROUTER_RESPONSE_INVALID", 1_024);
    if (redirectUri !== expectedRedirectUri) throw new NineRouterApiError("NINE_ROUTER_OAUTH_REDIRECT_MISMATCH");
    const session: NineRouterOAuthAuthorizationSession = freezeOpaqueSession({
      kind: "authorization-code",
      provider,
      authorization_url: authorizationUrl,
      callback_url: redirectUri,
    });
    authorizationSessionSecrets.set(session, { codeVerifier, redirectUri, state });
    return session;
  }

  /**
   * Exchanges one validated callback through 9Router and returns no token
   * material. Sessions are one-shot even when the upstream exchange fails.
   */
  async completeOAuthAuthorization(
    session: NineRouterOAuthAuthorizationSession,
    callbackUrl: string,
  ): Promise<NineRouterOAuthConnectionReceipt> {
    const secret = authorizationSessionSecrets.get(session);
    if (!secret) throw new NineRouterApiError("NINE_ROUTER_OAUTH_SESSION_INVALID");
    authorizationSessionSecrets.delete(session);
    const provider = oauthCapability(session.provider, "oauth-authorization-code");
    const code = authorizationCallback(callbackUrl, secret);
    const root = record(await this.request("POST", `/api/oauth/${provider}/exchange`, {
      code,
      redirectUri: secret.redirectUri,
      codeVerifier: secret.codeVerifier,
      state: secret.state,
    }), "NINE_ROUTER_RESPONSE_INVALID");
    const data = responseRecord(root);
    if (root.success !== true && data.success !== true) throw new NineRouterApiError("NINE_ROUTER_OAUTH_EXCHANGE_FAILED");
    return { provider, connected: true };
  }

  /**
   * Starts a device flow without exposing the device code, verifier, or
   * provider-specific polling payload. Only user-displayable instructions are
   * present on the returned frozen object.
   */
  async beginOAuthDevice(providerInput: string): Promise<NineRouterOAuthDeviceSession> {
    const provider = oauthCapability(providerInput, "oauth-device-code");
    const value = responseRecord(await this.request("GET", `/api/oauth/${provider}/device-code`));
    const deviceCode = textField(value.device_code, "NINE_ROUTER_RESPONSE_INVALID", 16_384);
    const codeVerifier = value.codeVerifier === undefined
      ? undefined
      : textField(value.codeVerifier, "NINE_ROUTER_RESPONSE_INVALID", 16_384);
    const verificationValue = typeof value.verification_uri_complete === "string" && value.verification_uri_complete.length > 0
      ? value.verification_uri_complete
      : value.verification_uri;
    const verificationUrl = externalHttpsUrl(verificationValue, "NINE_ROUTER_OAUTH_VERIFICATION_URL_INVALID");
    const userCode = value.user_code === undefined
      ? undefined
      : textField(value.user_code, "NINE_ROUTER_RESPONSE_INVALID", 256);
    const pollIntervalSeconds = boundedSeconds(value.interval, 5, 30);
    const expiresInSeconds = value.expires_in === undefined
      ? null
      : boundedSeconds(value.expires_in, 300, 86_400);
    const session: NineRouterOAuthDeviceSession = freezeOpaqueSession({
      kind: "device-code",
      provider,
      verification_url: verificationUrl,
      ...(userCode ? { user_code: userCode } : {}),
      poll_interval_seconds: pollIntervalSeconds,
      expires_in_seconds: expiresInSeconds,
    });
    deviceSessionSecrets.set(session, {
      codeVerifier,
      deviceCode,
      extraData: boundedJsonClone(value.extraData ?? value),
      pollIntervalSeconds,
    });
    return session;
  }

  /** Polls exactly once; the caller owns cancellable timing and retry bounds. */
  async pollOAuthDevice(session: NineRouterOAuthDeviceSession): Promise<NineRouterOAuthDevicePoll> {
    const secret = deviceSessionSecrets.get(session);
    if (!secret) throw new NineRouterApiError("NINE_ROUTER_OAUTH_SESSION_INVALID");
    const provider = oauthCapability(session.provider, "oauth-device-code");
    const root = record(await this.request("POST", `/api/oauth/${provider}/poll`, {
      deviceCode: secret.deviceCode,
      ...(secret.codeVerifier ? { codeVerifier: secret.codeVerifier } : {}),
      extraData: secret.extraData,
    }), "NINE_ROUTER_RESPONSE_INVALID");
    const data = responseRecord(root);
    if (root.success === true || data.success === true) {
      deviceSessionSecrets.delete(session);
      return { status: "connected", provider };
    }
    const error = typeof root.error === "string"
      ? root.error
      : typeof data.error === "string" ? data.error : undefined;
    const pending = root.pending === true || data.pending === true || error === "authorization_pending" || error === "slow_down";
    if (pending) {
      if (error === "slow_down") secret.pollIntervalSeconds = Math.min(secret.pollIntervalSeconds + 5, 30);
      return { status: "pending", retry_after_seconds: secret.pollIntervalSeconds };
    }
    deviceSessionSecrets.delete(session);
    throw new NineRouterApiError("NINE_ROUTER_OAUTH_DEVICE_FAILED");
  }

  async createProviderConnection(input: { provider: string; name: string; apiKey: string }): Promise<NineRouterCreatedObject> {
    const provider = textField(input.provider, "NINE_ROUTER_PROVIDER_INVALID", 128);
    const name = textField(input.name, "NINE_ROUTER_PROVIDER_NAME_INVALID");
    const apiKey = textField(input.apiKey, "NINE_ROUTER_PROVIDER_CREDENTIAL_INVALID", 16_384);
    const value = createdRecord(await this.request("POST", "/api/providers", { provider, name, apiKey }), "connection");
    return { id: safeId(value.id), name: typeof value.name === "string" ? textField(value.name, "NINE_ROUTER_RESPONSE_INVALID") : name };
  }

  async deleteProviderConnection(id: string): Promise<void> {
    await this.request("DELETE", `/api/providers/${safeId(id)}`);
  }

  async createCombo(input: { name: string; models: readonly string[] }): Promise<NineRouterCreatedObject> {
    const name = textField(input.name, "NINE_ROUTER_COMBO_NAME_INVALID");
    if (input.models.length < 1 || input.models.length > 256) throw new NineRouterApiError("NINE_ROUTER_COMBO_MODELS_INVALID");
    const models = input.models.map((model) => modelId(model, "NINE_ROUTER_COMBO_MODELS_INVALID"));
    if (new Set(models).size !== models.length) throw new NineRouterApiError("NINE_ROUTER_COMBO_MODELS_INVALID");
    const value = createdRecord(await this.request("POST", "/api/combos", { name, models }), "combo");
    return { id: safeId(value.id), name: typeof value.name === "string" ? textField(value.name, "NINE_ROUTER_RESPONSE_INVALID") : name };
  }

  async readCombo(id: string): Promise<NineRouterComboDetail> {
    const value = createdRecord(await this.request("GET", `/api/combos/${safeId(id)}`), "combo");
    if (!Array.isArray(value.models)) throw new NineRouterApiError("NINE_ROUTER_RESPONSE_INVALID");
    return {
      id: safeId(value.id),
      alias: textField(value.name, "NINE_ROUTER_RESPONSE_INVALID"),
      models: value.models.map((model) => modelId(model, "NINE_ROUTER_RESPONSE_INVALID")),
    };
  }

  async deleteCombo(id: string): Promise<void> {
    await this.request("DELETE", `/api/combos/${safeId(id)}`);
  }

  async createGatewayKey(name: string, capture: (secret: string) => Promise<void>): Promise<NineRouterGatewayKeyReceipt> {
    const requestedName = textField(name, "NINE_ROUTER_KEY_NAME_INVALID");
    const value = createdRecord(await this.request("POST", "/api/keys", { name: requestedName }), "key");
    const id = safeId(value.id);
    const secret = textField(value.key, "NINE_ROUTER_RESPONSE_INVALID", 16_384);
    try {
      await capture(secret);
    } catch {
      try { await this.request("DELETE", `/api/keys/${encodeURIComponent(id)}`); } catch { /* Preserve capture failure. */ }
      throw new NineRouterApiError("NINE_ROUTER_KEY_CAPTURE_FAILED");
    }
    return { id, name: typeof value.name === "string" ? textField(value.name, "NINE_ROUTER_RESPONSE_INVALID") : requestedName, captured: true };
  }

  async readGatewayKeys(): Promise<NineRouterGatewayKeySummary[]> {
    return responseArray(await this.request("GET", "/api/keys"), "keys").map((value) => {
      const item = record(value, "NINE_ROUTER_RESPONSE_INVALID");
      return { id: safeId(item.id), name: textField(item.name, "NINE_ROUTER_RESPONSE_INVALID") };
    });
  }

  async deleteGatewayKey(id: string): Promise<void> {
    await this.request("DELETE", `/api/keys/${safeId(id)}`);
  }

  async readCliToolSettings(tool: NineRouterCliTool): Promise<Record<string, unknown>> {
    if (!CLI_TOOLS.has(tool)) throw new NineRouterApiError("NINE_ROUTER_CLI_TOOL_INVALID");
    const value = await this.request("GET", `/api/cli-tools/${tool}-settings`);
    const root = record(value, "NINE_ROUTER_RESPONSE_INVALID");
    const data = root.data && typeof root.data === "object" && !Array.isArray(root.data) ? root.data : root;
    return secretFreeObject(data);
  }

  async applyCliToolSettings(tool: NineRouterCliTool, settings: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!CLI_TOOLS.has(tool)) throw new NineRouterApiError("NINE_ROUTER_CLI_TOOL_INVALID");
    assertNoCredentialFields(settings);
    const value = await this.request("POST", `/api/cli-tools/${tool}-settings`, settings);
    return secretFreeObject(createdRecord(value, "settings"));
  }
}
