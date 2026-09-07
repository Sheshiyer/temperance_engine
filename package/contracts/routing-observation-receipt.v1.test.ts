import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildReceipt, validateReceipt, parseReceipt,
  createRoutingObservationReceipt, validateRoutingObservationReceipt, parseRoutingObservationReceipt,
  ROUTING_OBSERVATION_RECEIPT_SCHEMA, ROUTING_OBSERVATION_MAX_BYTES,
  ROUTING_OBSERVATION_MAX_COUNT, ROUTING_OBSERVATION_REJECTION_CODES,
} from "./routing-observation-receipt.v1";

const policy = {
  registered_projects: ["prj_synthetic-project"],
  catalog: [{ provider: "synthetic", model: "synthetic/model-v1" }, { provider: "other", model: "other/model-v2" }],
  max_freshness_ms: 60_000,
};
function content(): any {
  return {
    schema: "temperance.routing-observation-receipt.v1",
    observation_id: "obs_" + "1".repeat(32), project_ref: "prj_synthetic-project",
    observed_at: "2026-09-07T00:00:00.000Z", fresh_until: "2026-09-07T00:01:00.000Z",
    source: "product-routing-adapter", evidence_mode: "synthetic",
    provenance: { product_source_commit: "2".repeat(40), closure_sha256: "3".repeat(64), contract_sha256: "4".repeat(64) },
    request: { outcome: "succeeded" },
    attribution: { state: "observed", provider: "synthetic", model: "synthetic/model-v1", successful_attempt_ordinal: 2, evidence_basis: "terminal-attempt-record" },
    tools: { state: "completed", started_count: 0, completed_count: 0, failed_count: 0 },
  };
}
function receipt(): any {
  const r = buildReceipt(content(), policy);
  if (!r.ok) throw new Error(r.code);
  return r.receipt;
}
function sorted(value: any): any {
  return value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
}
function rejection(result: any, code = "INVALID_RECEIPT") {
  expect(result).toEqual({ ok: false, code });
}

describe("routing observation receipt v1", () => {
  test("exports stable descriptive entry points and closed rejection codes", () => {
    expect(createRoutingObservationReceipt).toBe(buildReceipt);
    expect(validateRoutingObservationReceipt).toBe(validateReceipt);
    expect(parseRoutingObservationReceipt).toBe(parseReceipt);
    expect(ROUTING_OBSERVATION_RECEIPT_SCHEMA).toBe(content().schema);
    expect(ROUTING_OBSERVATION_MAX_BYTES).toBe(4096);
    expect(ROUTING_OBSERVATION_MAX_COUNT).toBe(10_000);
    expect(Object.isFrozen(ROUTING_OBSERVATION_REJECTION_CODES)).toBe(true);
    expect(ROUTING_OBSERVATION_REJECTION_CODES).toEqual(["INVALID_POLICY", "INVALID_RECEIPT", "INVALID_ENCODING", "INPUT_TOO_LARGE", "INVALID_JSON", "DUPLICATE_KEY", "DIGEST_MISMATCH"]);
  });
  test("builds a detached synthetic receipt with independently reproducible digest", () => {
    const input = content();
    const result = buildReceipt(input, policy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hash = createHash("sha256").update(JSON.stringify(sorted(input))).digest("hex");
    expect(result.receipt.receipt_id).toBe("ro_" + hash);
    // Independently generated with Python hashlib and sorted compact JSON.
    expect(result.receipt.receipt_id).toBe("ro_3d5c0214593f7424b1d505ed4c5001d73dde699dadf02b8ca5cad6bcd1d0fc84");
    expect(result.canonical).toBe(JSON.stringify(sorted(result.receipt)));
    expect(result.receipt.provenance).not.toBe(input.provenance);
    expect(validateReceipt(result.receipt, policy)).toEqual(result);
    expect(parseReceipt(result.canonical, policy)).toEqual(result);
    expect(buildReceipt(Object.fromEntries(Object.entries(input).reverse()), policy)).toEqual(result);
  });
  test("validates supplied digest rather than repairing it", () => {
    const r = receipt(); r.receipt_id = "ro_" + "0".repeat(64);
    rejection(validateReceipt(r, policy), "DIGEST_MISMATCH");
  });
  test("requires registered project and paired public catalog identity", () => {
    const a = content(); a.project_ref = "prj_unregistered"; rejection(buildReceipt(a, policy));
    const b = content(); b.attribution.model = "other/model-v2"; rejection(buildReceipt(b, policy));
  });
  test("accepts independent request, attribution, and tool states", () => {
    for (const outcome of ["succeeded", "failed", "unavailable"]) {
      for (const attribution of [content().attribution,
        ...["no_successful_attempt", "missing_attribution", "evidence_unavailable", "unsupported_identity"].map(reason_code => ({ state: "unavailable", reason_code })),
        ...["conflicting_attribution", "multiple_successful_bindings"].map(reason_code => ({ state: "ambiguous", reason_code }))]) {
        for (const tools of [content().tools,
          { state: "incomplete", reason_code: "open_tools", started_count: 2, completed_count: 0, failed_count: 1 },
          { state: "incomplete", reason_code: "tool_failed", started_count: 2, completed_count: 1, failed_count: 1 },
          { state: "incomplete", reason_code: "coverage_incomplete", started_count: 0, completed_count: 0, failed_count: 0 },
          { state: "unavailable", reason_code: "not_instrumented" }, { state: "unavailable", reason_code: "evidence_unavailable" }]) {
          const c = content(); c.request.outcome = outcome; c.attribution = attribution; c.tools = tools;
          expect(buildReceipt(c, policy).ok).toBe(true);
        }
      }
    }
  });
  test("rejects time and arithmetic contradictions", () => {
    for (const fresh_until of ["2026-09-07T00:00:00.000Z", "2026-09-07T00:01:00.001Z", "2026-02-30T00:00:00.000Z", "2026-09-07T00:01:00Z"]) {
      const c = content(); c.fresh_until = fresh_until; rejection(buildReceipt(c, policy));
    }
    for (const tools of [
      { state: "completed", started_count: 1, completed_count: 0, failed_count: 0 },
      { state: "completed", started_count: 1, completed_count: 1, failed_count: 1 },
      { state: "incomplete", reason_code: "open_tools", started_count: 1, completed_count: 1, failed_count: 0 },
      { state: "incomplete", reason_code: "tool_failed", started_count: 1, completed_count: 0, failed_count: 0 },
      { state: "incomplete", reason_code: "coverage_incomplete", started_count: 1, completed_count: 1, failed_count: 1 },
    ]) { const c = content(); c.tools = tools; rejection(buildReceipt(c, policy)); }
  });
  test("raw JSON rejects escaped duplicate keys and trailing data", () => {
    const json = JSON.stringify(receipt());
    rejection(parseReceipt(json.replace('"schema":', '"schema":"x","sch\\u0065ma":'), policy), "DUPLICATE_KEY");
    rejection(parseReceipt(json + " null", policy), "INVALID_JSON");
  });
  test("does not invoke hostile getters or proxy traps", () => {
    let touched = false;
    const c = content(); Object.defineProperty(c, "schema", { get() { touched = true; throw new Error("private"); }, enumerable: true });
    rejection(buildReceipt(c, policy));
    const proxy = new Proxy(content(), { ownKeys() { touched = true; throw new Error("private"); } });
    rejection(buildReceipt(proxy, policy));
    expect(touched).toBe(false);
  });

  test("closes each accepted object against missing and extra fields", () => {
    const variants = [content(), ...["unavailable", "ambiguous"].map(state => {
      const c = content(); c.attribution = { state, reason_code: state === "unavailable" ? "missing_attribution" : "conflicting_attribution" };
      c.tools = state === "unavailable" ? { state: "unavailable", reason_code: "not_instrumented" } : { state: "incomplete", reason_code: "coverage_incomplete", started_count: 0, completed_count: 0, failed_count: 0 };
      return c;
    })];
    for (const variant of variants) for (const path of [[], ["provenance"], ["request"], ["attribution"], ["tools"]]) {
      const original = path.length ? variant[path[0]] : variant;
      for (const key of Object.keys(original)) {
        const c = structuredClone(variant); const target = path.length ? c[path[0]] : c; delete target[key];
        rejection(buildReceipt(c, policy));
      }
      for (const key of ["metadata", "prompt", "account_id", "connection_id", "error", "resolved", "url"]) {
        const c = structuredClone(variant); const target = path.length ? c[path[0]] : c; target[key] = "SYNTHETIC_PRIVATE_SENTINEL";
        rejection(buildReceipt(c, policy));
      }
    }
    const r = receipt(); delete r.receipt_id; rejection(validateReceipt(r, policy));
    rejection(buildReceipt(receipt(), policy));
  });

  test("every accepted content leaf affects the digest", () => {
    const baseline = receipt().receipt_id;
    const edits: [string[], any][] = [
      [["observation_id"], "obs_" + "9".repeat(32)], [["project_ref"], "prj_other-project"],
      [["observed_at"], "2026-09-07T00:00:00.001Z"], [["fresh_until"], "2026-09-07T00:00:59.999Z"],
      [["evidence_mode"], "local-observation"], [["provenance", "product_source_commit"], "9".repeat(40)],
      [["provenance", "closure_sha256"], "9".repeat(64)], [["provenance", "contract_sha256"], "9".repeat(64)],
      [["request", "outcome"], "failed"], [["attribution", "provider"], "alternate"], [["attribution", "model"], "alternate-model"],
      [["attribution", "successful_attempt_ordinal"], 3],
      [["attribution"], { state: "unavailable", reason_code: "missing_attribution" }],
      [["tools"], { state: "completed", started_count: 1, completed_count: 1, failed_count: 0 }],
      [["tools"], { state: "incomplete", reason_code: "tool_failed", started_count: 1, completed_count: 0, failed_count: 1 }],
    ];
    const p = { ...policy, registered_projects: [...policy.registered_projects, "prj_other-project"], catalog: [...policy.catalog, { provider: "alternate", model: "synthetic/model-v1" }, { provider: "synthetic", model: "alternate-model" }] };
    for (const [path, value] of edits) {
      const c = content(); if (path.length === 1) c[path[0]] = value; else c[path[0]][path[1]] = value;
      const r = buildReceipt(c, p); expect(r.ok).toBe(true);
      if (r.ok) expect(r.receipt.receipt_id).not.toBe(baseline);
    }
    for (const reason_code of ["not_instrumented", "evidence_unavailable"]) {
      const c = content(); c.tools = { state: "unavailable", reason_code };
      const r = buildReceipt(c, policy); expect(r.ok).toBe(true);
      if (r.ok) expect(r.receipt.receipt_id).not.toBe(baseline);
    }
  });

  test("rejects non-plain, inherited, symbolic, hidden, cyclic, accessor and coercible values", () => {
    const hidden = content(); Object.defineProperty(hidden.request, "hidden", { value: "private" });
    const symbol = content(); symbol.provenance[Symbol("private")] = "private";
    const cycle = content(); cycle.request.outcome = cycle;
    const accessor = content(); Object.defineProperty(accessor.tools, "started_count", { enumerable: true, get() { throw new Error("private"); } });
    const inherited = Object.assign(Object.create({ private: "private" }), content());
    const nestedProxy = content(); nestedProxy.request = new Proxy(nestedProxy.request, { getPrototypeOf() { throw new Error("private"); } });
    const revoked = Proxy.revocable(content(), {}); revoked.revoke();
    const poison = content(); poison.observation_id = { toString() { throw new Error("private"); } };
    for (const c of [undefined, null, [], new Date(0), new Map(), new String("private"), hidden, symbol, cycle, accessor, inherited, nestedProxy, revoked.proxy, poison]) rejection(buildReceipt(c, policy));
    const safe = content(); Object.setPrototypeOf(safe, null); expect(buildReceipt(safe, policy).ok).toBe(true);
  });

  test("validates policy before trusting registration or public catalog declarations", () => {
    const bad: any[] = [null, {}, [], { ...policy, extra: true }, { ...policy, catalog: [] }, { ...policy, registered_projects: [] },
      { ...policy, catalog: [{ provider: "synthetic", model: "synthetic/model-v1", account_id: "private" }] },
      { ...policy, catalog: [...policy.catalog, policy.catalog[0]] }, { ...policy, registered_projects: [...policy.registered_projects, policy.registered_projects[0]] },
      { ...policy, registered_projects: ["/private/path"] }, { ...policy, catalog: [{ provider: "bad@private", model: "model" }] },
      ...[0, -1, 86_400_001, 1.5, NaN, Infinity, "60000"].map(max_freshness_ms => ({ ...policy, max_freshness_ms })),
    ];
    const getter = { ...policy }; Object.defineProperty(getter, "catalog", { enumerable: true, get() { throw new Error("private"); } }); bad.push(getter);
    const sparse = { ...policy, registered_projects: new Array(1) }; bad.push(sparse);
    const arrayProp = { ...policy, catalog: [...policy.catalog] }; (arrayProp.catalog as any).secret = "private"; bad.push(arrayProp);
    bad.push(new Proxy(policy, { ownKeys() { throw new Error("private"); } }));
    for (const p of bad) rejection(buildReceipt(content(), p), "INVALID_POLICY");
    expect(buildReceipt(content(), { ...policy, max_freshness_ms: 86_400_000 }).ok).toBe(true);
  });

  test("enforces numeric and identifier boundaries without coercion", () => {
    for (const field of ["started_count", "completed_count", "failed_count"]) for (const value of [-0, -1, 10_001, 0.5, NaN, Infinity, "0", false, null]) {
      const c = content(); c.tools[field] = value; rejection(buildReceipt(c, policy));
    }
    for (const value of [0, -0, -1, 10_001, 1.5, NaN, Infinity, "1", false, null]) {
      const c = content(); c.attribution.successful_attempt_ordinal = value; rejection(buildReceipt(c, policy));
    }
    for (const value of [1, 10_000]) { const c = content(); c.attribution.successful_attempt_ordinal = value; expect(buildReceipt(c, policy).ok).toBe(true); }
    const max = content(); max.tools.started_count = max.tools.completed_count = 10_000; expect(buildReceipt(max, policy).ok).toBe(true);
    for (const value of ["obs_" + "a".repeat(31), "obs_" + "a".repeat(33), "obs_" + "A".repeat(32), "obs_" + "1".repeat(31) + "\n"]) {
      const c = content(); c.observation_id = value; rejection(buildReceipt(c, policy));
    }
    for (const field of ["closure_sha256", "contract_sha256", "product_source_commit"]) {
      const c = content(); c.provenance[field] = c.provenance[field].toUpperCase().replace(/./, "A"); rejection(buildReceipt(c, policy));
    }
    for (const [provider, model] of [["a".repeat(65), "model"], ["provider", "m".repeat(129)], ["provider", "https://private"], ["provider", "m\u0000"], ["provider", "m\ud800"]]) {
      rejection(buildReceipt(content(), { ...policy, catalog: [{ provider, model }] }), "INVALID_POLICY");
    }
    const bounded = content(); bounded.project_ref = "prj_" + "x".repeat(60); bounded.attribution.provider = "a".repeat(64); bounded.attribution.model = "m".repeat(128);
    expect(buildReceipt(bounded, { ...policy, registered_projects: [bounded.project_ref], catalog: [{ provider: bounded.attribution.provider, model: bounded.attribution.model }] }).ok).toBe(true);
  });

  test("uses exact calendar UTC timestamps and policy duration with no clock-relative judgment", () => {
    for (const observed_at of ["2026-02-29T00:00:00.000Z", "2026-09-07T24:00:00.000Z", "2026-09-07T00:00:60.000Z", "2026-09-07T00:00:00.000+00:00", "2026-09-07T00:00:00.000z", "2026-09-07T00:00:00.0000Z"]) {
      const c = content(); c.observed_at = observed_at; rejection(buildReceipt(c, policy));
    }
    for (const year of ["0000", "2024", "9999"]) {
      const c = content(); c.observed_at = year + "-02-28T23:59:59.999Z"; c.fresh_until = year + "-03-01T00:00:00.000Z";
      // Leap years span Feb 29 (86,400,001 ms); 9999 is non-leap (1 ms).
      expect(buildReceipt(c, policy).ok).toBe(year === "9999");
    }
    const c = content(); c.observed_at = "2024-02-29T23:59:59.999Z"; c.fresh_until = "2024-03-01T00:00:00.000Z";
    expect(buildReceipt(c, { ...policy, max_freshness_ms: 1 }).ok).toBe(true);
  });

  test("strict JSON grammar rejects duplicates at every depth and malformed documents", () => {
    const raw = JSON.stringify(receipt());
    for (const key of ["schema", "outcome", "provider", "started_count", "closure_sha256"]) {
      const encoded = key[0] + "\\u" + key.charCodeAt(1).toString(16).padStart(4, "0") + key.slice(2);
      rejection(parseReceipt(raw.replace('"' + key + '":', '"' + key + '":null,"' + encoded + '":'), policy), "DUPLICATE_KEY");
    }
    for (const raw of ["", "{", "{\"x\":}", "{\"x\":1,}", "{\"x\":01}", "{\"x\":true false}", "{\"x\":\"\\x20\"}", "{\"x\":\"\n\"}", "{\"x\":\"unterminated}", "{}x", "NaN", "undefined", "//comment\n{}", "{\"x\":+1}"]) rejection(parseReceipt(raw, policy), "INVALID_JSON");
    for (const raw of ["[]", "null", "false", "42", '"string"', '{"x":1e999}']) rejection(parseReceipt(raw, policy));
    rejection(parseReceipt('{"x":"\\ud800"}', policy), "INVALID_ENCODING");
    rejection(parseReceipt('{"x":"\\udc00"}', policy), "INVALID_ENCODING");
  });

  test("enforces encoded byte limit, fatal UTF-8, BOM rejection and plain byte arrays", () => {
    const raw = JSON.stringify(receipt()); const encode = (s: string) => new TextEncoder().encode(s);
    const padded = raw + " ".repeat(4096 - encode(raw).length);
    expect(parseReceipt(padded, policy).ok).toBe(true); expect(parseReceipt(encode(padded), policy).ok).toBe(true);
    rejection(parseReceipt(padded + " ", policy), "INPUT_TOO_LARGE");
    rejection(parseReceipt(encode(padded + " "), policy), "INPUT_TOO_LARGE");
    rejection(parseReceipt("é".repeat(2049), policy), "INPUT_TOO_LARGE");
    for (const bytes of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82]]) rejection(parseReceipt(new Uint8Array(bytes), policy), "INVALID_ENCODING");
    rejection(parseReceipt("\ufeff" + raw, policy), "INVALID_ENCODING"); rejection(parseReceipt(encode("\ufeff" + raw), policy), "INVALID_ENCODING");
    rejection(parseReceipt(raw + "\ud800", policy), "INVALID_ENCODING");
    for (const bytes of [new DataView(new ArrayBuffer(1)), new Uint16Array(1), new Proxy(encode(raw), {}), Buffer.from(raw)]) rejection(parseReceipt(bytes, policy), "INVALID_ENCODING");
    const extra = encode(raw); (extra as any).secret = "private"; rejection(parseReceipt(extra, policy), "INVALID_ENCODING");
  });

  for (const View of [Uint16Array, Float64Array]) {
    test(`rejects forged ${View.name} without truncating elevated values`, () => {
      const bytes = new TextEncoder().encode(JSON.stringify(receipt()));
      const forged = View.from(bytes, value => value + 256);
      Object.setPrototypeOf(forged, Uint8Array.prototype);
      rejection(parseReceipt(forged, policy), "INVALID_ENCODING");
    });
  }

  test("does not mutate input or policy and returns fixed private rejection codes", () => {
    const c = content(); const p = structuredClone(policy); const before = JSON.stringify({ c, p });
    Object.freeze(c.provenance); Object.freeze(c.attribution); Object.freeze(c.tools); Object.freeze(c.request); Object.freeze(c);
    const built = buildReceipt(c, p); expect(built.ok).toBe(true); expect(JSON.stringify({ c, p })).toBe(before);
    if (built.ok) { built.receipt.request.outcome = "failed"; expect(c.request.outcome).toBe("succeeded"); }
    const secret = content(); secret.attribution = { state: "observed", provider: "SYNTHETIC_PRIVATE_SENTINEL", model: "private" };
    const r = buildReceipt(secret, policy); rejection(r); expect(JSON.stringify(r)).not.toContain("SYNTHETIC_PRIVATE_SENTINEL");
    const supplied = receipt(); const prior = JSON.stringify(supplied); validateReceipt(supplied, policy); expect(JSON.stringify(supplied)).toBe(prior);
  });

  test("validates synthetic fixtures and recursively closed structural schema", () => {
    for (const name of ["observed-completed", "unavailable", "ambiguous-incomplete"]) {
      const raw = readFileSync(new URL(`./fixtures/routing-observation-receipt.v1/${name}.json`, import.meta.url), "utf8");
      expect(JSON.parse(raw).evidence_mode).toBe("synthetic"); expect(parseReceipt(raw, policy).ok).toBe(true);
    }
    const schema = JSON.parse(readFileSync(new URL("./routing-observation-receipt.v1.schema.json", import.meta.url), "utf8"));
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    function visit(value: any): void {
      if (!value || typeof value !== "object") return;
      if (value.type === "object") { expect(value.additionalProperties).toBe(false); expect(value.required.sort()).toEqual(Object.keys(value.properties).sort()); }
      for (const child of Object.values(value)) visit(child);
    }
    visit(schema);
  });

  test("production source imports only deterministic built-ins and declares ownership", () => {
    const source = readFileSync(new URL("./routing-observation-receipt.v1.ts", import.meta.url), "utf8");
    expect([...source.matchAll(/^import .+ from "([^"]+)";/gm)].map(match => match[1])).toEqual(["node:crypto", "node:util"]);
    expect(source).not.toMatch(/\b(?:process|fetch|console|Bun|require|setTimeout|setInterval)\b|Date\.now|Math\.random|new Date\(\s*\)|import\s*\(/);
    expect(source.startsWith("// Canonical product source.")).toBe(true);
  });
});
