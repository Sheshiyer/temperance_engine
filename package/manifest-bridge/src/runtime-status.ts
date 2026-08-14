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
  omniroute: EndpointReceipt;
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
      detail: gatewayReady ? (omniroute.status_code === 401 ? 'gateway reachable · auth protected' : 'gateway reachable') : 'gateway did not answer',
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
    `  ·  omniroute  ${omniroute.state.toUpperCase()} · ${omniroute.url} · ${omniroute.detail}`,
    '  ·  combo      see <temperance-rail> above; this receipt never exposes credentials',
    '</manifest-runtime>',
  ].join('\n');
}
