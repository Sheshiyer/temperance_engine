# Bounded build task — standalone composition

You own ONLY package/install-surface/src/composition/contracts.ts,
package/install-surface/src/composition/inspect.ts,
package/install-surface/src/composition/cli.ts,
package/install-surface/test/composition.test.ts,
package/install-surface/test/composition-cli.test.ts,
package/install-surface/examples/standalone-composition.v1.json.
You are not alone in the codebase. Never revert others or edit other files. Do not
commit, install dependencies, invoke providers, read host/private stores or use network.

Implement pure TypeScript (Bun/Node builtins only) portable composition with schema
`temperance.composition.v1`. Strict closed keys and bounded arrays/strings. Input:
{schema, product:{id:'temperance-engine',repository:'github.com/Sheshiyer/temperance_engine'},
 plant:{id,owner,kind:'local'|'hosted'}, coordinator:{surface:'codex-app'|'codex-cli'|'claude-app'|'claude-code'|'temperance-claude'|'grok-cli'|'opencode'|'cursor'|'antigravity',mode:'native'},
 modules:[{id,owner,plant_id,requires:[],configuration_refs:[]}],
 integrations:[{id,repository,plant_id,requires:[]}]}.
Module IDs from a closed generic set: routing.gateway, skills.binding, executor.git,
executor.hands, transport.a2a, projection.manifest, projection.constellation,
projection.banner, projection.island, organ.vestibule, organ.adytum, organ.nutrix,
organ.auspex, organ.circulator, organ.praeceptor. Author defines actual dependencies
and owners (portable symbolic IDs), but generic minimum dependencies enforced:
hands needs executor.git and skills.binding; a2a needs executor.hands;
constellation needs projection.manifest; adytum needs vestibule;
circulator/praeceptor need nutrix. Declaration does NOT enable anything.
Ref syntax is symbolic `binding:NAME` or `secret-ref:NAME`; never values or paths.
Repo identity `github.com/owner/repo` strict; no URLs, paths, queries or .git suffix.
All modules/integrations must match plant id. Reject duplicates/cycles/self-deps,
unknown fields, prototype/accessor input, dangling deps, malformed refs, raw private
values, integration taking product identity, any non-native coordinator mode.
Input bound 64KiB, max64 modules,max16 integrations,max32 refs/requirements per item.
No stringified input in errors (fixed codes only). Validate prior canonical hashing.
Return normalized clone not caller object. Deterministic ordering canonical by IDs.

Read-only `inspectComposition(input, observations?, now?)`: observations strict
{schema:'temperance.composition-observations.v1',plant_id,observed_at,expires_at,
 modules:[{id,state:'unavailable'|'detected'|'configured'|'healthy'|'admitted',
 configuration_refs:[]}]} with same limits, duplicates rejected. Dates canonical UTC,
not future, now injected integer epoch ms; expiry ordered and max5min. Absent/stale
observations -> unknown or stale, cross-plant -> throw. An admitted state is merely
caller-declared observation, NEVER authoritative admission. Output fixed schema
`temperance.composition-report.v1`, configuration-only mode, effect_authorized:false,
source manifest digest, plant public identity, coordinator, integration IDs/repos,
module rows owner/state/missing refs/dependency blockers, readiness `unknown`|`held`|
`configuration-observed` (last only if own fresh configured-or-better state + all
required refs + dependencies similarly satisfied). A failed dependency propagates.
Do not return input refs values, raw input or observation strings. Always include
kernel:{requires_integrations:false,requires_superset:false,acceptance_owner:'isa',
planning_owner:'gsd',execution_authorized:false}. No actual routing provider selection.

CLI helper export `runCompositionCommand(args, readInput)` returns {code,stdout,stderr}.
Accept `inspect` only and JSON stdin packet {manifest, observations?}. At most64KiB.
No flags/paths. Valid prints canonical JSON report newline, code0 (configuration
inspection, not readiness grant); invalid fixed error JSON stderr code2, empty stdout.
Use injected now if needed in test interface. Implement module executable via
import.meta.main calling helper with process argv and bounded stream reading stdin.
No top-level live host probes, filesystem writes, network or env reads.

Example minimal standalone plant, native Codex, integrations:[], executor.git and
skills.binding and projection.banner modules with no external requirements.
Tests assert independence from Cambium/Superset and mutation-free input; plant/repo
identity, private input refusal, authority nonpromotion, dependency failure,
expiry/future boundary, duplicates/cycles, deterministic permutations, CLI invalid
arguments/oversized input and safe errors. Run focused tests if Bun available.
Return actual changed files, test results and limits; do not claim whole-plan completion.
