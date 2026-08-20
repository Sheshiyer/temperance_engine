import { activeRunFor, type ActivationResult, type ActiveAlgorithmRun } from './activation';

export type RuntimeReachability = 'ready' | 'offline';

export interface EndpointReceipt {
  state: RuntimeReachability;
  url: string;
  status_code?: number;
  detail: string;
}

export interface ManifestRuntimeReceipt {
  manifest: EndpointReceipt & { event_count?: number; freshness?: string };
  omniroute: EndpointReceipt & { edge?: 'local' | 'clio' };
  activation: {
    state: 'active' | 'rejected' | 'unavailable';
    reason: string;
    run?: ActiveAlgorithmRun;
  };
}

function baseUrl(value: string): string {
  return value.replace(/\/$/, '');
}

async function probe(url: string, expectedService?: string): Promise<{ status_code?: number; json?: Record<string, unknown> }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(350) });
    let json: Record<string, unknown> | undefined;
    try { json = await response.json() as Record<string, unknown>; } catch { /* a gateway may deliberately return an empty/HTML response */ }
    if (expectedService && (!response.ok || json?.service !== expectedService)) return { status_code: response.status, json };
    return { status_code: response.status, json };
  } catch { return {}; }
}

export async function manifestRuntimeReceipt(input: {
  activation?: ActivationResult;
  session_id?: string;
  state_dir?: string;
  bridge_url?: string;
  omniroute_url?: string;
} = {}): Promise<ManifestRuntimeReceipt> {
  const bridgeUrl = baseUrl(input.bridge_url || process.env.TEMPERANCE_MANIFEST_BRIDGE_URL || 'http://127.0.0.1:8766');
  const omnirouteUrl = baseUrl(input.omniroute_url || process.env.TEMPERANCE_OMNIROUTE_URL || 'http://127.0.0.1:20128');
  const edge: 'local' | 'clio' = /clio|company|relay/i.test(omnirouteUrl) || process.env.TEMPERANCE_EDGE === 'clio' ? 'clio' : 'local';
  const [bridge, omniroute] = await Promise.all([
    probe(`${bridgeUrl}/health`, 'temperance-manifest-bridge'),
    // OmniRoute deliberately protects this API with auth. A 401 proves the local
    // gateway is reachable without teaching a prompt hook to read a secret.
    probe(`${omnirouteUrl}/api/status`),
  ]);
  const bridgeReady = bridge.status_code === 200 && bridge.json?.service === 'temperance-manifest-bridge';
  const gatewayReady = Boolean(omniroute.status_code && omniroute.status_code < 500);
  const activation = input.activation;
  const run = activation?.run || activeRunFor(input.session_id, input.state_dir);
  const activationState = run ? 'active' : activation?.accepted === false ? 'rejected' : 'unavailable';
  const activationReason = run ? `${run.enrollment} · ${run.mode}${run.tier ? ` · ${run.tier}` : ''}` : activation?.reason || 'no active Algorithm receipt';
  return {
    manifest: {
      state: bridgeReady ? 'ready' : 'offline', url: bridgeUrl, status_code: bridge.status_code,
      detail: bridgeReady ? 'health verified' : 'no healthy loopback bridge',
      event_count: typeof bridge.json?.event_count === 'number' ? bridge.json.event_count : undefined,
      freshness: typeof bridge.json?.status === 'string' ? bridge.json.status : undefined,
    },
    omniroute: {
      state: gatewayReady ? 'ready' : 'offline', url: omnirouteUrl, status_code: omniroute.status_code,
      edge,
      detail: gatewayReady ? (omniroute.status_code === 401 ? `gateway reachable · auth protected · edge ${edge}` : `gateway reachable · edge ${edge}`) : 'gateway did not answer',
    },
    activation: { state: activationState, reason: activationReason, run },
  };
}

/** Bounded, secret-free context injected after an Algorithm classifier result. */
export function formatManifestRuntimeContext(receipt: ManifestRuntimeReceipt): string {
  const run = receipt.activation.run;
  const manifest = receipt.manifest;
  const omniroute = receipt.omniroute;
  return [
    '<manifest-runtime>',
    `☿ MANIFEST · ${manifest.state === 'ready' ? 'READY' : 'OFFLINE'}`,
    `  ·  bridge     ${manifest.url} · ${manifest.detail}${manifest.event_count !== undefined ? ` · events ${manifest.event_count}` : ''}`,
    `  ·  run        ${run ? `${run.run_id} · ${run.project_id}` : receipt.activation.state.toUpperCase()} · ${receipt.activation.reason}`,
    `  ·  omniroute  ${omniroute.state.toUpperCase()} · ${omniroute.url} · edge ${omniroute.edge || 'local'} · ${omniroute.detail}`,
    '  ·  combo      see <temperance-rail> above; this receipt never exposes credentials',
    `  ·  console    ${process.env.TEMPERANCE_MANIFEST_CONSOLE_URL || 'http://127.0.0.1:5173'}`,
    '</manifest-runtime>',
  ].join('\n');
}

export type PaiSessionMode = 'MINIMAL' | 'NATIVE' | 'ALGORITHM';
export type PaiSurface = 'grok' | 'codex' | 'claude' | 'opencode' | string;

const MODES: PaiSessionMode[] = ['MINIMAL', 'NATIVE', 'ALGORITHM'];

export function asPaiMode(value: unknown): PaiSessionMode | null {
  const mode = String(value || '').toUpperCase();
  return (MODES as string[]).includes(mode) ? mode as PaiSessionMode : null;
}

export function detectPaiSurface(explicit?: string): PaiSurface {
  const named = String(explicit || process.env.TEMPERANCE_SURFACE || '').toLowerCase();
  if (named) return named;
  if (process.env.GROK_SESSION || process.env.GROK) return 'grok';
  if (process.env.CLAUDE_PROJECT_DIR || process.env.CLAUDECODE) return 'claude';
  if (process.env.OPENCODE) return 'opencode';
  return 'codex';
}

function pickerTool(surface: PaiSurface): string {
  return surface === 'grok' ? 'ask_user_question' : 'AskUserQuestion';
}

function iabLine(surface: PaiSurface, url: string): string[] {
  if (surface === 'grok') {
    return [
      `Grok has no ChatGPT in-app browser. Print this Manifest URL; do not open Chrome/Safari: ${url}`,
    ];
  }
  return [
    'Open the ChatGPT in-app browser only (Browser plugin, agent.browsers.get("iab")).',
    'Do not use Chrome, Safari, or an external browser.',
    `Navigate to: ${url}`,
  ];
}

export function formatPaiModeOffer(input: {
  session_id?: string;
  project_id?: string;
  chosen?: PaiSessionMode | null;
  bound?: PaiSessionMode | null;
  classifier?: PaiSessionMode | null;
  surface?: PaiSurface;
  console_url?: string;
}): string {
  const consoleUrl = (input.console_url || process.env.TEMPERANCE_MANIFEST_CONSOLE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
  const project = input.project_id || 'all';
  const surface = detectPaiSurface(input.surface);
  const bound = asPaiMode(input.bound);
  const chosen = asPaiMode(input.chosen);
  const classifier = asPaiMode(input.classifier);
  const effective = chosen || bound || (classifier === 'ALGORITHM' || classifier === 'MINIMAL' ? classifier : null);
  if (effective) {
    const url = `${consoleUrl}/?project=${encodeURIComponent(project)}&mode=${encodeURIComponent(effective)}`;
    const why = chosen ? 'session pick' : bound ? `/gsd:* map` : 'classifier auto';
    return [
      '<pai-mode-offer>',
      `Mode ${effective} is already bound (${why}). Do not present a picker. Do not write MINIMAL/NATIVE/ALGORITHM as a chat reply.`,
      ...iabLine(surface, url),
      'The LCARS phase strip stays visible in every mode. Clusters/workflows change with the mode.',
      '</pai-mode-offer>',
    ].join('\n');
  }
  const tool = pickerTool(surface);
  const url = `${consoleUrl}/?project=${encodeURIComponent(project)}&mode=<MINIMAL|NATIVE|ALGORITHM>`;
  return [
    '<pai-mode-offer>',
    `BEFORE any other work, call the native tool ${tool} once.`,
    surface === 'grok'
      ? 'On Grok that is the blocking question card (↑↓, 1-3, Enter). It is not a NOESIS bullet list.'
      : 'On Codex/Claude/OpenCode that is AskUserQuestion / option tiles — the same windows used for model and permission choices.',
    'Do not paste the three modes into a chat reply. A reply is not a picker.',
    'Ask exactly one question. Do not start work until the tool returns.',
    '',
    'Question: Which PAI path should this session take?',
    'Options:',
    '- MINIMAL — greeting/ack only. Alchemical strip still visible. No skill clusters.',
    '- NATIVE — one-step via temperance-native. One spoke. te-fast only if needed.',
    '- ALGORITHM — using-superpowers then /temperance-algorithm. Full cluster + workflow. Phase combos.',
    '',
    'AFTER the tool returns, persist that mode and:',
    ...iabLine(surface, url),
    '</pai-mode-offer>',
  ].join('\n');
}
