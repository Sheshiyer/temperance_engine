# Phase 1: Provenance Contract and Read-Only Control Plane - Pattern Map

**Mapped:** 2026-08-20
**Files analyzed:** 48
**Analogs found:** 43 / 48
**Scope:** CLI-only. No UI-SPEC. No walking skeleton. Do not create `package/install-surface/` in this mapping step. Do not edit product `ISA.md` beyond quoting analog paths.

Phase 1 is a **new package**. Closest analogs live beside it (`package/manifest-bridge`, `package/router`, `package/headless`, `scripts/`, `tests/`). Copy TypeScript ESM, schema-literal, canonical-JSON, owner-only `lstat`, and Bun-test shapes. Do **not** import Manifest Bridge's event catalog, PostgreSQL control ledger, doctor write APIs, or jq.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `package/install-surface/package.json` | config | request-response | `package/manifest-bridge/package.json` | role-match |
| `package/install-surface/bun.lock` | config | file-I/O | `package/manifest-bridge/bun.lock` | role-match |
| `package/install-surface/schemas/fragment.v1.schema.json` | schema | transform | `package/headless/schema/shadow-attempt.v1.schema.json` | exact |
| `package/install-surface/schemas/lock.v1.schema.json` | schema | transform | `package/headless/schema/shadow-attempt.v1.schema.json` | exact |
| `package/install-surface/schemas/private-registry.v1.schema.json` | schema | transform | `package/headless/schema/shadow-attempt.v1.schema.json` | exact |
| `package/install-surface/schemas/doctor-report.v1.schema.json` | schema | transform | `package/router/omniroute-promotion.schema.json` | exact |
| `package/install-surface/fragments/hooks.json` | config | transform | `package/headless/share/policy.v1.json` | role-match |
| `package/install-surface/fragments/router.json` | config | transform | `package/headless/share/policy.v1.json` | role-match |
| `package/install-surface/fragments/manifest.json` | config | transform | `package/headless/share/policy.v1.json` | role-match |
| `package/install-surface/fragments/enrichment.json` | config | transform | `package/headless/share/policy.v1.json` | role-match |
| `package/install-surface/fragments/skills.json` | config | transform | `package/headless/share/policy.v1.json` | role-match |
| `package/install-surface/fragments/private-boundaries.json` | config | transform | `package/headless/share/policy.v1.json` | role-match |
| `package/install-surface/deny-policy.v1.json` | config | transform | `scripts/verify-install.sh` private-path scan | partial |
| `package/install-surface/install-surface-manifest.lock.json` | config | transform | no committed compiler-output analog | none |
| `package/install-surface/src/types.ts` | model | transform | `package/manifest-bridge/src/types.ts` | exact |
| `package/install-surface/src/schema.ts` | compiler | transform | RESEARCH Ajv snippet; `package/headless/lib/runtime.mjs` `exactObject` | partial |
| `package/install-surface/src/canonical-json.ts` | utility | transform | `package/router/omniroute-cloudflare-production-adapter.ts` `canonical()` | exact |
| `package/install-surface/src/path-policy.ts` | utility | transform | `package/router/omniroute-native-control-plane.ts` `canonicalPath()` | role-match |
| `package/install-surface/src/deny-policy.ts` | compiler | transform | `scripts/verify-install.sh` lines 104-133 | partial |
| `package/install-surface/src/semantic-validation.ts` | compiler | transform | `package/relocation/project-packet-schema.ts` `validateProjectYaml` | role-match |
| `package/install-surface/src/authority.ts` | compiler | transform | `ISA.md` ISC-769..788 checklist | none |
| `package/install-surface/src/compile.ts` | compiler | transform | `package/manifest-bridge/src/catalog.ts` `persistRegistryUnlocked` | partial |
| `package/install-surface/src/load.ts` | compiler | file-I/O | `package/router/omniroute-cloudflare-promotion.ts` `parseStrictJsonDocument` | role-match |
| `package/install-surface/src/private-registry.ts` | observer | file-I/O | `package/router/omniroute-cloudflare-production-adapter.ts` `openOwnerOnlyRegular()` | role-match |
| `package/install-surface/src/doctor/model.ts` | model | request-response | `package/manifest-bridge/src/doctor.ts` `DoctorReport` | role-match |
| `package/install-surface/src/doctor/orchestrator.ts` | observer | request-response | `package/manifest-bridge/src/doctor.ts` `runManifestDoctor` | role-match |
| `package/install-surface/src/doctor/render-human.ts` | renderer | transform | `package/manifest-bridge/src/doctor.ts` `formatDoctorReport` | exact |
| `package/install-surface/src/doctor/render-json.ts` | renderer | transform | `package/manifest-bridge/src/cli.ts` `--json` branch | exact |
| `package/install-surface/src/doctor/sections/install.ts` | observer | file-I/O | `package/manifest-bridge/src/doctor.ts` `scanEvents` / `checkHooks` | role-match |
| `package/install-surface/src/doctor/sections/privacy.ts` | observer | file-I/O | `openOwnerOnlyRegular()` + D-10 allowlist (no redaction-spread) | partial |
| `package/install-surface/src/doctor/sections/runtime.ts` | observer | request-response | `package/manifest-bridge/src/runtime-status.ts` `manifestRuntimeReceipt` | exact |
| `package/install-surface/src/cli.ts` | cli | request-response | `package/manifest-bridge/src/cli.ts` | role-match |
| `package/install-surface/test/fixtures/` | test | file-I/O | `package/headless/fixtures/` | exact |
| `package/install-surface/test/schema.test.ts` | test | transform | `package/headless/test/runtime.test.mjs` unknown-field tests | role-match |
| `package/install-surface/test/semantics.test.ts` | test | transform | `package/relocation/project-packet-schema.ts` + Bun tests | role-match |
| `package/install-surface/test/authority.test.ts` | test | transform | no ISA-loader test analog | none |
| `package/install-surface/test/determinism.test.ts` | test | transform | `package/headless/test/determinism.test.mjs` | exact |
| `package/install-surface/test/privacy.test.ts` | test | file-I/O | `package/router/omniroute-cloudflare-production-adapter.test.ts` owner-only tests | role-match |
| `package/install-surface/test/doctor.test.ts` | test | request-response | `package/manifest-bridge/test/bridge.test.ts` doctor tests | role-match |
| `package/install-surface/test/cli.test.ts` | test | request-response | `tests/temperance-doctor.sh` | role-match |
| `bin/temperance` | wrapper | request-response | `package/headless/bin/temperance-shadow` | exact |
| `scripts/temperance-doctor.sh` | wrapper | request-response | itself (NEGATIVE analog) | role-match |
| `tests/temperance-doctor.sh` | test | request-response | itself | exact |
| `scripts/verify-all.sh` | wrapper | batch | itself | exact |
| `package/manifest-bridge/src/cli.ts` | cli | request-response | itself (NEGATIVE: `--record`, `--repair-duplicates`) | exact |
| `package/manifest-bridge/src/doctor.ts` | observer | request-response | itself (NEGATIVE: writes) | exact |
| `package/manifest-bridge/test/bridge.test.ts` | test | request-response | itself (NEGATIVE: `record: true`) | exact |
| `ISA.md` | config | transform | itself ISC-769..788 (quote-only this phase) | exact |

## Pattern Assignments

### `package/install-surface/package.json` (config, request-response)

**Analog:** `package/manifest-bridge/package.json`

**Imports / package shape** (lines 1-16):
```json
{
  "name": "temperance-manifest-bridge",
  "private": true,
  "type": "module",
  "scripts": {
    "doctor": "bun run src/cli.ts doctor",
    "test": "bun test"
  }
}
```

**Copy:** `"private": true`, `"type": "module"`, `"test": "bun test"`, CLI scripts that `bun run src/cli.ts <command>`. Pin the sole new production dependency as `ajv` exact `8.20.0` (`bun add -E --ignore-scripts ajv@8.20.0`).

**Do not copy:** `"pg"` / `"@types/pg"`. This package must not depend on PostgreSQL, Manifest Bridge, or event-catalog modules.

**Data flow:** maintainer/CI → package scripts → `src/cli.ts` / `bun test`.

---

### `package/install-surface/bun.lock` (config, file-I/O)

**Analog:** `package/manifest-bridge/bun.lock` (package-local lock, not repo-root).

**Copy:** isolate dependency closure next to the package, same as Manifest Bridge.

**Do not copy:** Manifest Bridge's `pg` graph.

**Data flow:** `bun add` → committed lock bytes → CI install.

---

### `package/install-surface/schemas/{fragment,lock,private-registry,doctor-report}.v1.schema.json` (schema, transform)

**Analog:** `package/headless/schema/shadow-attempt.v1.schema.json` plus `package/router/omniroute-promotion.schema.json`

**Core schema pattern** (`shadow-attempt.v1.schema.json` lines 1-12):
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://thoughtseed.space/schemas/hermes-temperance-shadow-attempt.v1.json",
  "title": "Thoughtseed Hermes Temperance shadow attempt",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "hermes", "context", "approval", "intent", "proof"],
  "properties": {
    "schema": { "const": "thoughtseed.hermes.temperance_shadow_attempt.v1" },
```

**Digest-field pattern** (`omniroute-promotion.schema.json` lines 37-41):
```json
    "manifest_hash": {"type": "string", "pattern": "^sha256:[a-f0-9]{64}$"},
    "nonce": {"type": "string", "minLength": 16},
    "runtime_version": {"type": "string", "minLength": 1},
    "policy_version": {"const": "temperance-routing-v1"},
```

**Copy:** Draft 2020-12 `$schema`, `$id`, `additionalProperties: false` on every object, `const` schema names, `enum` for closed vocabularies, `sha256:[a-f0-9]{64}` for digests. On composed unions use `unevaluatedProperties: false` (not present in these analogs; required by RESEARCH Pattern 1).

**Do not copy:** Hermes/Cloudflare field names, `signature` / HMAC fields, host identity, lease timestamps inside lock schema, or any `generated_at` on the lockfile schema.

**Data flow:** JSON bytes → Ajv strict compile → typed fragment/lock/registry/report objects or `MANIFEST_SCHEMA_INVALID`.

---

### `package/install-surface/fragments/*.json` (config, transform)

**Analog:** `package/headless/share/policy.v1.json`

**Core pattern** (lines 1-12):
```json
{
  "schema": "thoughtseed.temperance.shadow_policy.v1",
  "version": "thoughtseed.temperance.shadow_policy.v1",
  "routes": {
    "legal:contract.create": {
      "logicalBackend": "kimi",
      "requiredSkills": [
        "anthropic-skills:thoughtseed-contract-generator"
      ],
```

**Copy:** reviewed static JSON with a versioned `schema` literal and stable IDs. Fragments are source authority; they are not host state.

**Do not copy:** Hermes backends, skill names as execution, or any absolute host path. `private-boundaries.json` must use public-safe symbolic NEVER-SHIP IDs only (D-05/D-06) — never `atlasRecall.ts` as an installed filename, never provider/bindings.

**Data flow:** authored fragment JSON → `compile.ts` → canonical lock bytes.

Preferred filenames (CONTEXT/RESEARCH discretion, now locked for planning): `hooks.json`, `router.json`, `manifest.json`, `enrichment.json`, `skills.json`, `private-boundaries.json`.

---

### `package/install-surface/deny-policy.v1.json` (config, transform)

**Analog:** `scripts/verify-install.sh` lines 104-133 (NEGATIVE for implementation language; POSITIVE for public-safe generic rules)

**Core pattern:**
```sh
private_home_pattern="/""Users""/"
private_volume_pattern="/""Volumes""/madara"
if grep -R -n -I -F \
  -e "$private_home_pattern" \
  -e "$private_volume_pattern" \
  ...
  printf '%s\n' "private local path found in public/install surface" >&2
```

**Copy:** fail-closed public scan against generic secret/database/log/history/memory/backup/private-root patterns; no silent rewrite of candidates (D-07).

**Do not copy:** grep as the product engine, maintainer-specific `/Users` or `/Volumes/madara` as named product rules, or jq. Policy rule IDs must be symbolic (`rule-only` vs `safe-relative-path` disclosure). Never encode provider/account/personal names.

**Data flow:** candidate relative path → symbolic rule match → compiler error (no write).

---

### `package/install-surface/install-surface-manifest.lock.json` (config, transform)

**Analog:** none for a committed compiled inventory. Write mechanic only: `package/manifest-bridge/src/catalog.ts` `persistRegistryUnlocked` (lines 211-216).

**Copy later via compile command:** two-space JSON + trailing newline + same-directory temp + `renameSync`.

**Do not copy:** `generated_at`, absolute checkout, platform, locale, self-digest inside the authenticated bytes, event-catalog records, or host token bindings.

**Data flow:** in-memory normalized inventory → exact committed bytes → CI byte-for-byte drift check. Doctor **loads** these bytes; it never regenerates them.

---

### `package/install-surface/src/types.ts` (model, transform)

**Analog:** `package/manifest-bridge/src/types.ts`

**Imports / literals** (lines 1-6):
```typescript
export const EVENT_SCHEMA = 'temperance.manifest.event.v1' as const;
export const STATE_SCHEMA = 'temperance.manifest.state.v1' as const;

export type EventStatus = 'observed' | 'derived' | 'synthetic' | 'stale' | 'failed';
export type EventSource = 'pai-hook' | 'temperance-router' | 'omniroute' | 'project-artifact' | 'codegraph' | 'manifest';
```

**Copy:** `as const` schema strings (`temperance.install-surface.fragment.v1`, `temperance.install-surface.lock.v1`, `temperance.doctor.report.v1`, `temperance.private-registry.v1`), discriminated string unions, interfaces that embed `schema: typeof SCHEMA`.

**Do not copy:** event/session/agent maps, `redaction: 'bounded-preview'`, PostgreSQL types from `control-ledger.ts`.

**Data flow:** schema constants → compile/load/doctor typed values.

Target condition union (D-18, not the analog's lowercase statuses):

`PASS | DRIFT | WARN | FAIL | SKIPPED | UNSUPPORTED | PRIVATE | UNAVAILABLE`

---

### `package/install-surface/src/schema.ts` (compiler, transform)

**Analog:** no Ajv usage in this repo. Copy RESEARCH snippet; fail-closed unknown-field style from `package/headless/lib/runtime.mjs` `exactObject` (lines 342-346).

**Ajv pattern (RESEARCH, not in-repo):**
```typescript
import Ajv2020 from "ajv/dist/2020";

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  validateSchema: true,
});
```

**Unknown-field pattern** (`runtime.mjs` 342-346):
```javascript
function exactObject(value, path, required, optional = []) {
  const object = record(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail("unknown_field", `unknown field ${path}.${key}`);
  }
```

**Copy:** compile schema once per process; `strict: true`; `allErrors: true`; never `validateSchema: false`. Bound byte size / record count before compile.

**Do not copy:** hand-rolled recursive validators as the structural engine (`contract.ts` `normalizeEvent` is the old style). Do not import `pg`.

**Data flow:** unknown JSON → Ajv → typed value or structured `MANIFEST_SCHEMA_INVALID`.

---

### `package/install-surface/src/canonical-json.ts` (utility, transform)

**Analog:** `package/router/omniroute-cloudflare-production-adapter.ts` lines 158-173, plus NFC/key-sort from `package/headless/lib/runtime.mjs` 322-339.

**Core pattern:**
```typescript
function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (!value || typeof value !== "object") fail("canonical_value_invalid");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function hashBytes(value: Buffer | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
```

**NFC / byte-stable key sort** (`runtime.mjs` 322-339):
```javascript
if (typeof value === "string") return value.normalize("NFC");
const keys = [...normalized.keys()].sort((left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
```

**Pretty lock bytes (RESEARCH):**
```typescript
const lockBytes = `${JSON.stringify(JSON.parse(canonical(normalizedLock)), null, 2)}\n`;
```

**Copy:** recursive key sort, NFC strings, `sha256:` prefix via `node:crypto`, pretty-print **after** canonical parse so CI compares exact bytes. Sort semantically unordered arrays **before** canonicalization.

**Do not copy:** hashing the canonical object and embedding that digest inside the lock; Cloudflare `fail("canonical_value_invalid")` error class name; time/path/platform fields.

**Data flow:** normalized lock object → canonical string → pretty bytes + external `sha256:` digest.

---

### `package/install-surface/src/path-policy.ts` (utility, transform)

**Analog:** `package/router/omniroute-native-control-plane.ts` `canonicalPath()` (672-692) for existing FS objects; RESEARCH `assertRepositoryRelative` for authored sources.

**Existing-object identity:**
```typescript
function canonicalPath(path: string, expectedUid: number, kind: "file" | "directory"): FileIdentity {
  if (!isAbsolute(path) || resolve(path) !== path || path !== path.normalize("NFC") || path.includes("\0")) {
    fail(`${kind}_path_invalid`);
  }
  const link = lstatSync(path);
  if (link.isSymbolicLink()) fail(`${kind}_symlink_forbidden`);
  if (realpathSync(path) !== path) fail(`${kind}_path_noncanonical`);
  const stat = statSync(path);
  if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) fail(`${kind}_type_invalid`);
  if (stat.uid !== expectedUid) fail(`${kind}_owner_invalid`);
  if ((stat.mode & 0o022) !== 0) fail(`${kind}_writable_by_others`);
  if (kind === "file" && stat.nlink !== 1) fail("file_link_count_invalid");
```

**Authored source containment (RESEARCH, derived from native-control-plane `relative()`):**
```typescript
function assertRepositoryRelative(repoRoot: string, declared: string): string {
  if (!declared || isAbsolute(declared) || declared.includes("\\") || declared.includes("\0")) {
    throw new Error("SOURCE_PATH_INVALID");
  }
  const candidate = resolve(repoRoot, declared);
  const rel = relative(resolve(repoRoot), candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("SOURCE_PATH_ESCAPE");
  }
  return candidate;
}
```

**Copy:** reject absolute sources, `\`, NUL, `.`/`..` segments, non-NFC, unknown root tokens; compare ownership by root token + normalized segments, not string prefixes. For live FS: `lstat` then `realpath`, owner/mode/nlink.

**Do not copy:**
- `canonicalExternalPath()` in the Cloudflare adapter (lines 186-192) — it **rejects in-repo paths** (secrets must live outside). Install sources **must** be in-repo.
- `activation.ts` `isWithin` (`root.startsWith(\`${allowedRoot}/\`)`) — prefix checks confuse siblings.
- Destination host binding during compile (PROV-04). Destinations stay `{root_token, relative_path}`.

**Data flow:** declared path + root token → validated structured path or `SOURCE_PATH_*` / `OWNERSHIP_OVERLAP`.

Collision rules to encode here or in `semantic-validation.ts`:
- `exclusive-path` conflicts with equal/ancestor/descendant under the same root token.
- `managed-block` may share a file only with distinct marker IDs and allowlisted composable adapters.
- Different root tokens do not collide until Phase 3 host binding.

---

### `package/install-surface/src/deny-policy.ts` (compiler, transform)

**Analog:** `scripts/verify-install.sh` 104-133 (policy intent) + D-07 disclosure rules.

**Copy:** generic symbolic rules; fail closed before any write; show repository-relative path only when the rule's disclosure policy is `safe-relative-path`.

**Do not copy:** grep, jq, maintainer absolute paths, private-root traversal, or mutating the candidate.

**Data flow:** normalized records → rule engine → `DENY_POLICY_MATCH` or pass.

---

### `package/install-surface/src/semantic-validation.ts` (compiler, transform)

**Analog:** `package/relocation/project-packet-schema.ts` `validateProjectYaml` (lines 61-79)

**Core pattern:**
```typescript
export type ProjectYamlValidationResult = { valid: true } | { valid: false; errors: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateProjectYaml(
  value: unknown,
  options: ValidateProjectYamlOptions,
): ProjectYamlValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(value)) {
    return { valid: false, errors: ["project.yaml must be an object"] };
  }
```

**Also copy** `package/manifest-bridge/src/contract.ts` `isRecord` (lines 11-13):
```typescript
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
```

**Copy:** collect **all** violations (not first-fail only); closed key sets; fail-closed unknown fields; second pass **after** schema validation. Implement cycle detection (Kahn/DFS) and segment-aware ownership here.

**Do not copy:** YAML, relocation grammar, `startsWith` containment, or writes.

**Data flow:** structurally valid records → `{valid:true}` or stable codes `OWNERSHIP_OVERLAP`, `DEPENDENCY_CYCLE`, `ADAPTER_COMBINATION_UNSAFE`.

---

### `package/install-surface/src/authority.ts` (compiler, transform)

**Analog:** none for an ISA/requirements loader. Quote product authority from `ISA.md` lines 1041-1060:

```markdown
- [x] ISC-769: The audit contains an explicit `COPY` classification table.
- [x] ISC-770: The audit contains an explicit `TRANSFORM` classification table.
- [x] ISC-771: The audit contains an explicit `REGENERATE` classification table.
- [x] ISC-772: The audit contains an explicit `NEVER-SHIP` classification table.
...
- [x] ISC-788: The workflow defines one installed-file provenance or checksum probe.
```

**Copy:** checklist IDs as ratification references; require every record to cite milestone requirement IDs **and** an ISA criterion that actually exists in canonical inputs.

**Do not copy:** creating `allowed-surfaces.json` (competing scope store). Do not treat a fragment `ratified_by` string as self-ratification (Pitfall 10). Mapper must not edit `ISA.md`; planner records the semantic-ID ratification gate as a human task.

**Data flow:** fragment authority refs + `ISA.md` / `.planning/REQUIREMENTS.md` text → accept or `AUTHORITY_REFERENCE_INVALID`.

---

### `package/install-surface/src/compile.ts` (compiler, transform)

**Analog:** `package/manifest-bridge/src/catalog.ts` `persistRegistryUnlocked` (211-216) **only for the explicit lock-write command**.

```typescript
private persistRegistryUnlocked(): void {
  mkdirSync(this.root, { recursive: true });
  const temporary = `${this.registryFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify([...this.records.values()], null, 2)}\n`, 'utf8');
  renameSync(temporary, this.registryFile);
}
```

**Copy:** in-memory validate → normalize sets → sort by semantic ID → canonical pretty bytes; write **only** from an explicit compile/lock command via temp + rename in the destination directory.

**Do not copy:** `mkdirSync` of host state roots, `withRegistryLock`, `ensureProject`, event ingest, `generated_at`, or any write on the doctor path. Compile must finish **all** structural/semantic/authority/deny checks before the write is allowed.

**Data flow:** fragments + deny policy + ISA refs → in-memory lock → optional atomic write of `install-surface-manifest.lock.json`.

---

### `package/install-surface/src/load.ts` (compiler, file-I/O)

**Analog:** `package/router/omniroute-cloudflare-promotion.ts` `parseStrictJsonDocument` (266-268) + `contract.ts` `normalizeEvent` for fail-closed field checks.

```typescript
export function parseStrictJsonDocument(text: string): unknown {
  if (Buffer.byteLength(text, "utf8") > 65_536) fail("manifest_document_too_large");
```

```typescript
export function normalizeEvent(input: unknown, defaults: Partial<ManifestEvent> = {}): ManifestEvent {
  if (!isRecord(input)) throw new Error('event must be a JSON object');
  ...
  if (!source || !VALID_SOURCES.has(source as EventSource)) throw new Error(`invalid event source: ${source || '<missing>'}`);
```

**Copy:** bounded parse, duplicate-key rejection, then schema + semantic validation. Doctor loads **committed lock bytes**, never a dirty recompile.

**Do not copy:** `randomUUID` ID generation, `new Date().toISOString()` defaults, event-catalog ingest, or `redact()` as the privacy boundary.

**Data flow:** lockfile bytes → typed inventory + `manifest_digest`.

---

### `package/install-surface/src/private-registry.ts` (observer, file-I/O)

**Analog:** `openOwnerOnlyRegular()` (`omniroute-cloudflare-production-adapter.ts` 202-219) + `stateRoot()` (`package/manifest-bridge/src/project.ts` 99-101).

```typescript
function openOwnerOnlyRegular(path: string, maxBytes: number, role = "secret"): number {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) fail(`production_${role}_file_invalid`);
  if (realpathSync(path) !== path) fail(`production_${role}_path_invalid`);
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW | CLOEXEC);
  try {
    const after = fstatSync(fd);
    if (after.dev !== before.dev || after.ino !== before.ino) fail(`production_${role}_file_raced`);
    if (after.uid !== currentUid()) fail(`production_${role}_owner_invalid`);
    if ((after.mode & 0o777) !== 0o600) fail(`production_${role}_mode_invalid`);
    if (after.nlink !== 1) fail(`production_${role}_hardlink_invalid`);
```

```typescript
export function stateRoot(): string {
  return process.env.TEMPERANCE_MANIFEST_STATE_DIR || join(homedir(), '.temperance_engine', 'state', 'manifest');
}
```

**Public projection constructor (RESEARCH / D-10 — copy this, not `redact()`):**
```typescript
function publicOverlay(record: ValidPrivateOverlayRecord, presence: PresenceState): PublicOverlay {
  return {
    schema_version: record.schema_version,
    id: record.id,
    class: record.class,
    enabled: record.enabled,
    presence,
    policy_rule_id: record.policy_rule_id,
  };
}
```

**Copy:** resolve operator state root in one host-only function; parent `0700`, file `0600`, current-user owner, regular file, no symlink, nlink 1; `lstat`/`realpath` on the **exact** binding only; absent file → empty registry + `SKIPPED` **without creating files**.

**Do not copy:**
- `loadActivationPolicy` absent-file = deny-all (`activation.ts` 63-73) — D-09 is the opposite (absent = healthy empty).
- `redact()` / `{...record, binding: '[REDACTED]'}` — future private fields would leak.
- `readdir`, recursive walk, open/hash of overlay contents, secret wiping (not a secret file).
- `writeFile` / `mkdir` / unregister mutation (D-12 is later).

**Data flow:** host registry path → allowlisted public projection (`schema_version, id, class, enabled, presence, policy_rule_id`).

Recommended live location (discretion): `<operator Temperance state root>/private-overlays/registry.v1.json`.

---

### `package/install-surface/src/doctor/model.ts` (model, request-response)

**Analog:** `package/manifest-bridge/src/doctor.ts` lines 10-27 (shape only).

```typescript
export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  id: string;
  status: DoctorStatus;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface DoctorReport {
  schema: 'temperance.manifest.doctor.v1';
  generated_at: string;
  overall: DoctorStatus;
  exit_code: number;
  state_dir: string;
  bridge_url: string;
  checks: DoctorCheck[];
}
```

**Copy:** versioned `schema` literal, `generated_at` on the **report** (not lock), `exit_code`, checks array. Extend to RESEARCH Pattern 7:

```typescript
interface DoctorReportV1 {
  schema: "temperance.doctor.report.v1";
  version: { major: 1; minor: 0 };
  generated_at: string;
  scope: { complete: boolean; requested_sections: DoctorSectionId[] };
  trustworthy: boolean;
  overall_condition: DoctorCondition;
  exit_code: 0 | 1 | 2;
  manifest_digest: `sha256:${string}`;
  sections: DoctorSection[];
}
```

Every check: `id`, logical `source`, public-safe `destination`, `class`, `expected_state`, `actual_state`, `condition`, `reason_code`, `severity`, `actionable`, `remediation`, bounded `evidence`.

**Do not copy:** lowercase `pass/warn/fail`; `state_dir` / `bridge_url` in the public envelope; `exit_code: overall === 'fail' ? 2 : 0` (warnings currently exit 0 — violates D-19).

**Data flow:** section results → one envelope → both renderers.

---

### `package/install-surface/src/doctor/orchestrator.ts` (observer, request-response)

**Analog:** `runManifestDoctor` (`doctor.ts` 192-223) as **structure**, plus catalog observer isolation (`catalog.ts` 83-85). **Negative analog for writes.**

**Core collect-then-aggregate:**
```typescript
export async function runManifestDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  ...
  const overall: DoctorStatus = checks.some((check) => check.status === 'fail') ? 'fail' : checks.some((check) => check.status === 'warn') ? 'warn' : 'pass';
  const report: DoctorReport = { schema: 'temperance.manifest.doctor.v1', generated_at: new Date().toISOString(), overall, exit_code: overall === 'fail' ? 2 : 0, ...};
  return report;
}
```

**Fail-open isolation** (`catalog.ts` 83-85):
```typescript
if (result.accepted && result.event) for (const listener of this.listeners) {
  try { listener(result.event); } catch { /* observers are fail-open */ }
}
```

**Bounded section** (RESEARCH / `AbortSignal.timeout` already used in `runtime-status.ts` 28):
```typescript
const response = await fetch(url, { signal: AbortSignal.timeout(350) });
```

**Copy:** compose named sections `install | privacy | runtime`; inject `ObservationIO` with **only** `readFile`, `lstat`, `realpath`, bounded `fetch`, allowlisted `execFile`, `now`. Timeouts: install 2000 ms, privacy 750 ms, runtime 4000 ms (named constants). Convert section throw/timeout to `UNAVAILABLE`; continue others. Sort sections `install, privacy, runtime` and checks by stable ID. Aggregate `FAIL > DRIFT > WARN > UNAVAILABLE`; non-actionable `PRIVATE|SKIPPED|UNSUPPORTED` keep overall `PASS`.

**Do not copy:** `repairDuplicateEvents`, `options.record` diagnostics write (218-221), `copyFileSync` backups, `mkdirSync`, `writeFileSync`, `renameSync`, `ManifestCatalog`, `pg`, `Promise.race` without aborting work, parsing component human text.

**Data flow:** lock bytes + public overlay projection + typed runtime adapter → `DoctorReportV1` → exit 0/1/2.

Exit algebra (D-19):
| Situation | trustworthy | exit |
|---|---|---|
| healthy / non-actionable requested evidence | yes | 0 |
| drift/warn/required fail/contained UNAVAILABLE | yes | 1 |
| invalid args/schema/orchestration | no | 2 |
| malformed private registry | yes (privacy FAIL) | 1 |
| filtered but healthy requested sections | yes | 0 (`scope.complete=false`) |

---

### `package/install-surface/src/doctor/render-human.ts` (renderer, transform)

**Analog:** `formatDoctorReport` (`doctor.ts` 225-230)

```typescript
export function formatDoctorReport(report: DoctorReport, verbose = false): string {
  const mark: Record<DoctorStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
  const lines = [`MANIFEST DOCTOR · ${report.overall.toUpperCase()}`, `  state     ${report.state_dir}`, `  bridge    ${report.bridge_url}`];
  for (const check of report.checks) lines.push(`  [${mark[check.status]}] ${check.id} · ${check.summary}${verbose && check.detail ? ` · ${JSON.stringify(check.detail)}` : ''}`);
  return lines.join('\n');
}
```

**Copy:** render from the structured report only; uppercase condition labels; `--verbose` expands public-safe records.

**Do not copy:** printing `state_dir`, `bridge_url`, plist paths, or `JSON.stringify(check.detail)` when detail may contain host paths. Drift-first / remediation-first order (D-17): overall, section summaries, every non-healthy item, actionable remediation — then verbose inventory.

**Data flow:** `DoctorReportV1` → stdout text. No I/O.

---

### `package/install-surface/src/doctor/render-json.ts` (renderer, transform)

**Analog:** `package/manifest-bridge/src/cli.ts` lines 30-34

```typescript
console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatDoctorReport(report, process.argv.includes('--verbose')));
process.exitCode = report.exit_code;
```

**Copy:** pretty JSON of the **same** report object; set `process.exitCode` from the report (do not `process.exit` before flush unless wrapping).

**Do not copy:** `--record` persistence, jq, or a second JSON shape.

**Data flow:** `DoctorReportV1` → stdout JSON. No I/O.

---

### `package/install-surface/src/doctor/sections/install.ts` (observer, file-I/O)

**Analog:** `checkHooks` / `scanEvents` (`doctor.ts` 62-80, 151-161) for read-only FS observation.

```typescript
function checkHooks(home: string, checks: DoctorCheck[]): void {
  const paths = [join(home, '.codex', 'hooks', 'PromptProcessing.hook.ts'), join(home, '.claude', 'hooks', 'PromptProcessing.hook.ts')];
  ...
  add(checks, 'prompt-hooks', ready ? (missing ? 'warn' : 'pass') : 'warn', ...);
}
```

**Copy:** observe declared sources/destinations through `ObservationIO`; class-aware verification (COPY digest, TRANSFORM in-memory adapter, REGENERATE semantic probe, NEVER-SHIP symbolic/presence-only). Distinguish required `FAIL`, optional `SKIPPED`, platform `UNSUPPORTED`.

**Do not copy:** hardcoded `$HOME/.claude` inventories as the provenance authority (lockfile is authority); event JSONL scanning; writing diagnostics.

**Data flow:** committed lock records → public-safe checks (`SOURCE_*`, `DESTINATION_*`, `OPTIONAL_NOT_SELECTED`, `PLATFORM_UNSUPPORTED`).

---

### `package/install-surface/src/doctor/sections/privacy.ts` (observer, file-I/O)

**Analog:** `openOwnerOnlyRegular()` + D-10 projection. Overlay ladder from D-11.

**Copy:** `SKIPPED` (disabled/unregistered), `PRIVATE` (enabled+present; **healthy, not drift**), `WARN` (enabled+missing), `FAIL` (malformed/insecure/policy). Convert all FS errors to reason codes **before** rendering so honeytoken paths never appear.

**Do not copy:** `redact()`; printing resolved paths; digesting overlay contents; `loadActivationPolicy` deny-all-on-absent.

**Data flow:** host registry → public overlay checks (`PRIVATE_*` reason family).

---

### `package/install-surface/src/doctor/sections/runtime.ts` (observer, request-response)

**Analog:** `package/manifest-bridge/src/runtime-status.ts` `manifestRuntimeReceipt` (36-72) + `checkLaunchd` (`doctor.ts` 176-182).

```typescript
async function probe(url: string, expectedService?: string): Promise<{ status_code?: number; json?: Record<string, unknown> }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(350) });
    ...
  } catch { return {}; }
}

function checkLaunchd(platform: NodeJS.Platform, checks: DoctorCheck[], id: 'bridge' | 'console', label: string): void {
  if (platform !== 'darwin') { add(checks, `${id}-launchd`, 'warn', 'launchd check is macOS-only.', { platform }); return; }
  try {
    execFileSync('launchctl', ['print', `gui/${process.getuid?.() || 0}/${label}`], { stdio: 'ignore', timeout: 700 });
```

**Copy:** typed adapter return objects (never parse human doctor text); `AbortSignal` / `execFile` timeout; Linux → `UNSUPPORTED` and **never** invoke launchd; 401 on OmniRoute counts as reachable without reading secrets.

**Do not copy:** `control-ledger.ts` / `import { Pool } from 'pg'`; verbose host plist paths in public evidence; `execFileSync` without timeout; treating component offline as exit 2.

**Data flow:** allowlisted probes → `COMPONENT_HEALTHY | COMPONENT_UNAVAILABLE | SECTION_TIMEOUT | SECTION_CRASHED`.

Wire Manifest Bridge as **one typed runtime adapter** by calling a read-only subset of `runManifestDoctor` **or** a new adapter that maps its checks into the v1 check record. Do not scrape `formatDoctorReport` text.

---

### `package/install-surface/src/cli.ts` (cli, request-response)

**Analog:** `package/manifest-bridge/src/cli.ts` lines 16-34, 102.

```typescript
function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

if (command === 'doctor') {
  const report = await runManifestDoctor({ ... record: process.argv.includes('--record'), repair_duplicates: process.argv.includes('--repair-duplicates') });
  console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatDoctorReport(report, process.argv.includes('--verbose')));
  process.exitCode = report.exit_code;
  return;
}
if (command !== 'serve') { usage(); process.exitCode = 2; return; }
```

**Copy:** `arg()`, `--json` / `--verbose`, unknown-command → exit 2, `process.exitCode` from report. Add repeatable `--section install|privacy|runtime`. Commands: `doctor` (read-only) and explicit `compile`/`lock` (the only writer).

**Do not copy:** `--record`, `--repair-duplicates`, default `serve`, `ManifestCatalog` construction on doctor, `init`/`sync` writes, jq.

Unknown `--section` or mutating flags on `doctor` → untrustworthy report, exit 2, guidance to Phase 3 repair/lifecycle names.

**Data flow:** argv → compile or doctor orchestrator → stdout + exit 0/1/2.

---

### `bin/temperance` (wrapper, request-response)

**Analog:** `package/headless/bin/temperance-shadow`

```sh
#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ "$#" -eq 1 ] && [ "$1" = "--help" ]; then
  exec /usr/bin/node "$ROOT_DIR/lib/runtime.mjs" --help
fi
```

**Copy:** POSIX `sh`, `set -eu`, resolve repo root from `$0`, `exec` into the real CLI. Prefer `bun` for this package (repo standard), not Node.

**Do not copy:** `--envelope` arity, `/usr/bin/node` hard-pin if Bun is the runtime, jq.

**Data flow:** `bin/temperance doctor …` → `package/install-surface/src/cli.ts`.

---

### `scripts/temperance-doctor.sh` (wrapper, request-response) — NEGATIVE analog

**Analog:** itself (lines 22-39, 297-318)

```sh
for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=true ;;
    ...
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 127; }
```

**Copy:** unknown option → exit 2; keep the filename as a compatibility entry.

**Do not copy:** jq (exit 127 violates D-19), associative-array inventory, hardcoded `$HOME` absolute probes, `direct_ready` JSON schema, `--require-auto` as the public contract.

**New behavior:** exec `bin/temperance doctor "$@"` (or `bun package/install-surface/src/cli.ts doctor "$@"`). Reject `--record` / `--repair-duplicates` / `--fix` with guidance.

**Data flow:** existing docs/tests calling this script → new typed doctor.

---

### `package/manifest-bridge/src/cli.ts` + `doctor.ts` (cli/observer, request-response) — NEGATIVE analog, required D-14 migration

**What to change (do not expand event catalog):**
- Doctor entry must not accept `record` / `repair_duplicates`.
- Move `repairDuplicateEvents` off the doctor command (Phase 3 repair namespace). Leave the function in-tree only if a non-doctor command calls it; otherwise keep it uninvoked from doctor.
- Delete the `options.record` `writeFileSync` diagnostics block from the doctor path.

**Negative excerpts not to reintroduce on the public doctor:**

`doctor.ts` 86-108 (`repairDuplicateEvents` writes backups + temp + rename):
```typescript
copyFileSync(entry.file, backup);
const temporary = `${entry.file}.${process.pid}.${Date.now()}.tmp`;
writeFileSync(temporary, retained.join('\n'), 'utf8'); renameSync(temporary, entry.file);
```

`doctor.ts` 218-221 (`--record` writes):
```typescript
if (options.record) {
  const directory = join(root, 'diagnostics'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `doctor-${report.generated_at.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
```

`cli.ts` 22 usage still advertises `--record` `--repair-duplicates` — remove from doctor usage.

**Do not copy into install-surface:** `copyFileSync`, `mkdirSync`, `writeFileSync`, `renameSync`, `pg`.

**Data flow:** component `manifest-bridge doctor` remains a focused diagnostic; mutating flags leave that surface.

---

### Tests

#### `package/install-surface/test/schema.test.ts`

**Analog:** `package/headless/test/runtime.test.mjs` 43-47 + fixture `package/headless/fixtures/invalid-unknown-field.v1.json`

```javascript
test("unknown fields fail closed", async () => {
  const envelope = await json(fixtureUrl);
  envelope.context.untrackedState = "must-not-be-accepted";
  assert.throws(() => validateEnvelope(envelope), /unknown field context\.untrackedState/);
});
```

**Copy:** valid v1.0; unknown nested field; missing required; unsupported major/minor; oversized input. Use `bun:test` (`package/manifest-bridge/test/bridge.test.ts` line 1):

```typescript
import { afterEach, describe, expect, test } from 'bun:test';
```

**Do not copy:** Node `node:test` as the package runner (headless is the old Node package).

#### `package/install-surface/test/semantics.test.ts`

**Analog:** `validateProjectYaml` closed-key accumulation + Bun adversarial tests.

Cover: duplicate ID, ownership ancestor/descendant, managed-block marker collision, cycles, unknown token, unsafe adapter/class, absolute/`..` sources.

#### `package/install-surface/test/authority.test.ts`

**Analog:** none. Load fixture `ISA.md` snippets; reject self-declared `ratified_by`; reject unknown ISC/requirement IDs.

#### `package/install-surface/test/determinism.test.ts`

**Analog:** `package/headless/test/determinism.test.mjs` 26-32

```javascript
test("two isolated processes emit byte-identical decisions with no backend PATH", async () => {
  const first = await invoke();
  const second = await invoke();
  assert.equal(first, second);
```

**Copy:** shuffle fragment filenames/record order/object key insertion; compile twice; compare **bytes** not parsed equality; empty `PATH` / `LANG=C` where relevant. Lock bytes must ignore clock.

#### `package/install-surface/test/privacy.test.ts`

**Analog:** `package/router/omniroute-cloudflare-production-adapter.test.ts` 212-231

```typescript
chmodSync(input.cloudflareToken, 0o644);
expect(() => readOwnerOnlySecretFile(input.cloudflareToken, REPOSITORY)).toThrow("production_secret_mode_invalid");
symlinkSync(input.cloudflareToken, symlink);
expect(() => readOwnerOnlySecretFile(symlink, REPOSITORY)).toThrow("production_secret_file_invalid");
```

**Copy:** mode/symlink/hardlink fail-closed; honeytokens in binding/label/provider/notes/error messages must be absent from human, JSON, verbose, and stderr.

**Do not copy:** secret-wipe assertions or Cloudflare HTTP.

#### `package/install-surface/test/doctor.test.ts`

**Analog:** `package/manifest-bridge/test/bridge.test.ts` 347-383 — **invert write assertions**.

Current analog **expects writes** (do not copy this expectation):
```typescript
const report = await runManifestDoctor({ ..., record: true });
expect(readdirSync(join(root, 'diagnostics')).some((name) => name.startsWith('doctor-'))).toBe(true);
...
const repaired = repairDuplicateEvents(root);
expect(repaired.removed).toBe(1);
```

**Copy instead:** snapshot fixture tree (names, bytes, modes, nlink, mtime) before/after doctor; `ObservationIO` fake with **no** write methods; timeout/crash isolation; class-aware COPY/TRANSFORM/REGENERATE/NEVER-SHIP table; eligibility table.

Also copy "importing performs no work" from production-adapter test 234-240:
```typescript
const before = readdirSync(input.root).sort();
adapter(input, async () => { calls += 1; return jsonResponse({}); });
expect(readdirSync(input.root).sort()).toEqual(before);
expect(calls).toBe(0);
```

#### `package/install-surface/test/cli.test.ts` + `tests/temperance-doctor.sh`

**Analog:** `tests/temperance-doctor.sh` 1-46

```bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP"
PATH="$TMP/.local/bin:$PATH" "$ROOT/scripts/temperance-doctor.sh" --json --no-network >"$TMP/direct.json"
```

**Copy:** isolated `HOME`, temp PATH, JSON + human + exit-code matrix, unknown flag → 2.

**Do not copy:** `jq -e '.direct_ready == true'` against `temperance-doctor-v1`; requiring jq for the product (jq may remain in this shell test until rewritten). Prefer Bun CLI tests for the v1 envelope; keep a thin installed-command shell test that execs the wrapper.

#### `scripts/verify-all.sh`

**Analog:** itself lines 7-16, 101

```sh
run() {
  printf '\n==> %s\n' "$*"
  "$@"
}
run bun test package/enrich
...
run bash tests/temperance-doctor.sh
```

**Copy:** add `run bun test package/install-surface` (or `cd package/install-surface && bun test`) **and** a lock-drift check that recompiles in memory and compares exact bytes to `install-surface-manifest.lock.json`. Keep `bash tests/temperance-doctor.sh`.

**Do not copy:** broad path-hygiene suppressions (Phase 2 debt). Do not add PostgreSQL tests.

CI already delegates via `.github/workflows/verify.yml` line 31 `./scripts/verify-all.sh` — no workflow fork required if verify-all grows.

---

### `ISA.md` (config, transform) — quote-only

**Analog:** `ISA.md` ISC-769..788 (lines 1041-1060).

Planner may add a **human ratification gate** for the initial semantic-ID set. This mapper does not edit `ISA.md`. Do not create a parallel allowlist file.

## Shared Patterns

### Schema literals and discriminated unions
**Source:** `package/manifest-bridge/src/types.ts` lines 1-6; `activation.ts` lines 8-9
**Apply to:** `src/types.ts`, all schemas, doctor envelope
```typescript
export const EVENT_SCHEMA = 'temperance.manifest.event.v1' as const;
export const ACTIVATION_POLICY_SCHEMA = 'temperance.manifest.activation-policy.v1' as const;
```
Target names: `temperance.install-surface.fragment.v1`, `temperance.install-surface.lock.v1`, `temperance.private-registry.v1`, `temperance.doctor.report.v1`.

### Canonical JSON + SHA-256
**Source:** `package/router/omniroute-cloudflare-production-adapter.ts` 158-173; `package/headless/lib/runtime.mjs` 322-339
**Apply to:** `canonical-json.ts`, compile, lock digest, COPY/TRANSFORM observers
Use `node:crypto.createHash('sha256')` and `sha256:` prefix. NFC-normalize strings. Sort object keys by UTF-8 bytes. Pretty-print lock with two spaces and one trailing newline.

### Strict unknown fields
**Source:** `package/headless/schema/shadow-attempt.v1.schema.json` `additionalProperties: false`; `runtime.mjs` `exactObject`
**Apply to:** all four schemas + Ajv `strict: true`
Unknown fields and unsupported versions fail closed (D-04).

### Path containment (not prefix)
**Source:** native-control-plane `canonicalPath` + RESEARCH `relative()` / `..${sep}`
**Apply to:** `path-policy.ts`, deny-policy, privacy binding checks
Reject `.`/`..`, backslash, NUL, non-NFC, absolute sources. Live FS: `lstat` → `realpath` → uid/mode/nlink.

### Owner-only regular file
**Source:** `openOwnerOnlyRegular()` 202-214; `assertOwnerOnlyDirectory()` 194-199
**Apply to:** private registry file (`0600`) and parent (`0700`)
Absent registry is empty/healthy (D-09), **not** activation-policy deny-all.

### Public projection, not redaction
**Source:** D-10 constructor; **negative** `contract.ts` `redact()` 15-26
**Apply to:** `private-registry.ts`, privacy section, verbose evidence
Explicit field pick. `redact()` is defense-in-depth for generic payloads only — never the private-overlay boundary.

### Read-only ObservationIO
**Source:** negative `doctor.ts` imports (`copyFileSync`, `mkdirSync`, `writeFileSync`, `renameSync`); positive injected `fetch`/`now` on `ProductionAdapterConfig`
**Apply to:** entire `src/doctor/**`
Doctor core must not import write APIs. Compile/lock is a separate command.

### Human and JSON from one object
**Source:** `cli.ts` 32-33; `formatDoctorReport`
**Apply to:** orchestrator + both renderers
Do not parse component human text (`docs/manifest-control-plane.md` observational boundary).

### Bounded probes
**Source:** `runtime-status.ts` `AbortSignal.timeout(350)`; `checkLaunchd` `execFileSync(..., { timeout: 700 })`
**Apply to:** runtime section and orchestrator timeouts
`execFile(binary, args, { timeout, signal })` — no `sh -c`, no manifest command strings.

### Observer isolation
**Source:** `catalog.ts` 83-85 try/catch around listeners
**Apply to:** section timeouts → `UNAVAILABLE`, remaining sections continue, exit 1 not 2.

### Atomic temp + rename (compile only)
**Source:** `catalog.ts` 213-216; `activation.ts` `writeRun` 92-97
**Apply to:** lockfile write command only
```typescript
const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
renameSync(temporary, path);
```

### Bun tests + isolated HOME for CLI
**Source:** `bridge.test.ts` `import { ... } from 'bun:test'`; `tests/temperance-doctor.sh` `mktemp` HOME
**Apply to:** all `package/install-surface/test/*.ts` and wrapper integration

### Canonical verifier entry
**Source:** `scripts/verify-all.sh`; CI `.github/workflows/verify.yml` line 31
**Apply to:** lock-drift + `bun test package/install-surface` + `tests/temperance-doctor.sh`

### Exit algebra (replace analog)
**Source:** D-19. **Negative analog:** `doctor.ts` 217 `exit_code: overall === 'fail' ? 2 : 0` and shell doctor 127 for missing jq.
**Apply to:** public `temperance doctor` and compatibility wrapper.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/schema.ts` Ajv instantiation | compiler | transform | Repo validators are hand-rolled (`contract.ts`, `runtime.mjs`). Use RESEARCH Ajv 8.20.0 Draft 2020-12 snippet. |
| `src/authority.ts` | compiler | transform | No code loads `ISA.md` as ratification input. Quote ISC-769..788; do not add `allowed-surfaces.json`. |
| `ObservationIO` interface | observer | request-response | Doctors call `node:fs` write APIs directly. New capability-limited interface; closest injection style is `ProductionAdapterConfig.fetch` / `now`. |
| `deny-policy.v1.json` structured rules | config | transform | Existing denylist is grep in `verify-install.sh`, not a versioned rule document. |
| `install-surface-manifest.lock.json` | config | transform | No committed compiled install inventory exists. Write mechanic only from `persistRegistryUnlocked`. |
| `test/authority.test.ts` | test | transform | No ISA-reference fixture tests. |

Planner should use `01-RESEARCH.md` Patterns 1-8 for these six, not Manifest Bridge event-catalog code.

## What never to copy (phase-wide)

| Anti-pattern | Source | Why |
|---|---|---|
| Event catalog / JSONL | `catalog.ts`, `store.ts` | Install provenance is a separate package (CONTEXT integration points). |
| PostgreSQL control ledger | `control-ledger.ts` `import { Pool } from 'pg'` | Outside Phase 1; would make doctor depend on production DB. |
| Doctor writes | `repairDuplicateEvents`, `--record` | Violates D-14. |
| jq as product dependency | `scripts/temperance-doctor.sh` line 39 | Missing jq exits 127, violating D-19. |
| `generated_at` in lockfile | `ManifestState.generated_at` | Makes CI drift permanent. |
| Host token binding at compile | `stateRoot()` absolute home paths | PROV-04 / D-08. |
| `redact()` as privacy projection | `contract.ts` 15-26 | New private fields leak. |
| `startsWith(root)` containment | `activation.ts` `isWithin` | Sibling-prefix hazard. |
| `canonicalExternalPath` in-repo rejection | Cloudflare adapter 186-192 | Opposite of repository-relative sources. |
| Absent file = deny-all | `loadActivationPolicy` | Opposite of D-09. |
| launchd on Linux | `checkLaunchd` currently `warn` | Phase 1 must report `UNSUPPORTED`. |
| Parsing human doctor text | shell doctor / docs temptation | D-13 typed adapters. |
| UI / walking skeleton | `package/manifest-zone` | CLI-only phase. |

## Lifecycle class contracts (Pattern 4 — no in-repo compiler analog)

Copy the **classification tables** ratified in `ISA.md` ISC-769..772 and the audit `docs/plans/2026-08-19-mac-mini-to-public-temperance-glove-audit.md`. Encode as discriminated unions in `types.ts`:

| Class | Source | Verification | Digest |
|---|---|---|---|
| `COPY` | repo-relative file/tree | dest vs source SHA-256 | public source + dest only |
| `TRANSFORM` | template + allowlisted adapter ID/version | render in memory, SHA-256 | never a shell command string |
| `REGENERATE` | generator ID + public inputs | semantic probe | host-derived values out of lock |
| `NEVER-SHIP` | symbolic identity only | `symbolic-exclusion` / presence-only | no path, traversal, or digest |

## Metadata

**Analog search scope:** `package/manifest-bridge/src`, `package/manifest-bridge/test`, `package/router/omniroute-cloudflare-production-adapter.ts`, `package/router/omniroute-native-control-plane.ts`, `package/router/omniroute-cloudflare-promotion.ts`, `package/router/omniroute-promotion.schema.json`, `package/headless/{schema,bin,lib,test,fixtures,share}`, `package/relocation/project-packet-schema.ts`, `package/enrich/contract.ts`, `scripts/{temperance-doctor.sh,verify-all.sh,verify-install.sh}`, `tests/temperance-doctor.sh`, `.github/workflows/verify.yml`, `ISA.md` ISC-769..788
**Files scanned:** 28 analog sources read (plus CONTEXT/RESEARCH/REQUIREMENTS/ROADMAP)
**Pattern extraction date:** 2026-08-20
**New production dependency:** `ajv@8.20.0` only
**Out of this map:** `package/install-surface/` implementation, UI-SPEC, walking skeleton, Phase 3 repair commands, private overlay register/unregister mutation, Phase 2 payload convergence
