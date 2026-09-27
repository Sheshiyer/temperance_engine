import { decodeEventInput, MAX_EVENT_INPUT_BYTES, observationResponse, ROUTING_OBSERVATION_KIND, type EventSink } from './routing-observation';
import type { ManifestEvent } from './types';

export interface EventResponse {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body: string): unknown;
}
export interface EventPostSink extends EventSink { refresh?(): void; }
export type EventDiagnostic = (value: { kind: string; project_id?: string; accepted: boolean; outcome: 'accepted' | 'deduplicated' | 'rejected'; error?: string }) => void;

/** The real POST /events handler delegates here; fake async byte streams require no socket. */
export async function handleEventPost(
  chunks: AsyncIterable<Uint8Array>, response: EventResponse, sink: EventPostSink,
  options: { headers?: Record<string, string>; diagnostic?: EventDiagnostic } = {},
): Promise<void> {
  const reply = (status: number, value: unknown): void => {
    response.writeHead(status, options.headers || { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  };
  try {
    let size = 0;
    const buffers: Uint8Array[] = [];
    for await (const chunk of chunks) {
      size += chunk.byteLength;
      if (size > MAX_EVENT_INPUT_BYTES) { reply(400, { accepted: false, error: 'input_too_large' }); return; }
      buffers.push(chunk);
    }
    const decoded = decodeEventInput(Buffer.concat(buffers));
    if (!decoded.ok) { reply(400, { accepted: false, error: decoded.error }); return; }
    const input = decoded.input as Partial<ManifestEvent> | null;
    const kind = input && typeof input.kind === 'string' ? input.kind : '';
    if (!decoded.special && /^(approval|dispatch)\./.test(kind)) {
      reply(400, { accepted: false, error: 'approval and dispatch lifecycle events are reserved for controlled local endpoints' }); return;
    }
    // Generic activation writers retain their refresh-before-retry behavior. Observation
    // admission performs its own validated, locked replay without eager projection/SSE effects.
    if (!decoded.special) sink.refresh?.();
    const result = sink.ingest(decoded.input);
    const safeResult = decoded.special ? observationResponse(result) : result;
    try {
      options.diagnostic?.({
        kind: decoded.special ? ROUTING_OBSERVATION_KIND : kind,
        project_id: decoded.special ? result.event?.project_id : input?.project_id,
        accepted: result.accepted,
        outcome: result.error ? 'rejected' : result.accepted ? 'accepted' : 'deduplicated',
        error: decoded.special ? safeResult.error as string | undefined : result.error,
      });
    } catch { /* diagnostics cannot change admission */ }
    reply(result.error ? 400 : result.accepted ? 201 : 200, safeResult);
  } catch { reply(400, { accepted: false, error: 'invalid_json' }); }
}
