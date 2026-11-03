function keyOrder(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function hasSemanticId(value: unknown): value is { id: string } {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === "string",
  );
}

export function normalizeCanonical(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("CANONICAL_NUMBER_INVALID");
    return value;
  }
  if (Array.isArray(value)) {
    const normalized = value.map(normalizeCanonical);
    if (normalized.every(hasSemanticId)) {
      return normalized.sort((left, right) => keyOrder(left.id, right.id));
    }
    return normalized;
  }
  if (!value || typeof value !== "object") {
    throw new TypeError("CANONICAL_VALUE_INVALID");
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key.normalize("NFC"), item] as const)
    .sort(([left], [right]) => keyOrder(left, right));
  // Canonical payloads may contain reviewed file maps. A normal object would
  // invoke Object.prototype's __proto__ setter and silently lose that leaf.
  // A null-prototype object preserves every own JSON key deterministically.
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of entries) {
    if (Object.hasOwn(output, key)) throw new TypeError("CANONICAL_KEY_COLLISION");
    Object.defineProperty(output, key, {
      value: normalizeCanonical(item),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

export function canonical(value: unknown): string {
  return `${JSON.stringify(normalizeCanonical(value), null, 2)}\n`;
}

/** Neutral action inputs preserve array order and exact string bytes.
 * Callers validate plain JSON before using this serializer. v1 metadata keeps
 * its historical semantic-array and Unicode normalization above.
 */
export function canonicalExact(value: unknown): string {
  function order(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(order);
    if (item && typeof item === "object") {
      const result = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(item).sort(keyOrder)) result[key] = order((item as Record<string, unknown>)[key]);
      return result;
    }
    return item;
  }
  return JSON.stringify(order(value)) + "\n";
}
