export interface BoundedOutcome<T> { outcome: "completed" | "failed" | "timeout" | "cancelled"; value?: T; cancellation_requested: boolean; callback_settled: boolean }

/** Trusted callbacks remain outside isolation. A timeout never means completion. */
export async function invokeBounded<T>(callback: (signal: AbortSignal) => Promise<T> | T, timeout: number, parent?: AbortSignal): Promise<BoundedOutcome<T>> {
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000) throw new Error("LIFECYCLE_TIMEOUT_INVALID");
  const controller = new AbortController();
  if (parent?.aborted) return { outcome: "cancelled", cancellation_requested: true, callback_settled: true };
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve().then(() => callback(controller.signal)).then(
    value => { settled = true; return { outcome: "completed" as const, value }; },
    () => { settled = true; return { outcome: "failed" as const }; },
  );
  const expiry = new Promise<{ outcome: "timeout" }>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve({ outcome: "timeout" }); }, timeout);
  });
  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<{ outcome: "cancelled" }>(resolve => {
    onAbort = () => { controller.abort(); resolve({ outcome: "cancelled" }); };
    parent?.addEventListener("abort", onAbort, { once: true });
    if (parent?.aborted) onAbort();
  });
  try {
    const result = await Promise.race([work, expiry, cancellation]);
    return { ...result, cancellation_requested: controller.signal.aborted, callback_settled: settled };
  } finally {
    clearTimeout(timer);
    if (onAbort) parent?.removeEventListener("abort", onAbort);
  }
}
