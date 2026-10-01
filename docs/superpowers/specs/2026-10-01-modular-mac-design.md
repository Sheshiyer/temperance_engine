Execution admitted by the owner on 2026-10-01 for Tasks 1–8 in their owning repositories. Earlier proposal-only and Task 1–2 adoption text below records the review state; it does not limit this execution. Physical effects require the actual reviewed destination packet.

# Modular Mac lifecycle and rich TUI design

Status: proposed design, 2026-10-01. No implementation or host migration
approved by this document. Acceptance belongs to the root Cambium ISA for
this review; future implementation must enter each owning repository's ISA.

## Intent

Give the owner one understandable, modular way to reconstruct a workstation
or add an always-on Mac, then operate and recover it. Both scenarios are
equally important. The experience must explain what exists, what is ready,
what is held, what will change, and how to resume or reverse owned effects.

Success is a capability graph verified on the destination, not a copied
collection of dot directories or a successful installer exit.

The [growth deep pass](../../architecture/2026-10-01-growth-ecosystem-review.md)
adds the relationships that this graph must preserve: Cambium admission,
five operating organs, six cognitive organs, selected Mac/Hermes plant,
independent verification, receipt and proposed learning. They are one
integrated ecosystem with different writers.

## Ownership and reuse

The generic product owner should be the Temperance distribution repository,
extending `package/install-surface`. Cambium hosts this review and retains
its independent operational authority. The personal Temperance runtime
supplies an explicit overlay. Snow Gloves OS remains a separate product
with its own runtime, installer, state and roadmap; it supplies no bundled
Temperance pack and is not required by either Mac profile. Hermes, Vault,
Antahkarana, Session Atlas, Factor and Meristem retain their own ownership.

The operator rejects merging this ecosystem into Snow Gloves OS. Cambium
and Temperance work together; sharing contracts does not transfer credentials,
registries, releases or operational authority. Temperance restores selected
Cambium project source and reconnects owner interfaces; Cambium's operational
store and deployment lifecycle stay with Cambium.
Any later Snow Gloves integration requires a separate, narrow contract and
must remain optional. Its install/update/uninstall is outside this executor.

Reuse the current OpenTUI renderer and `onboarding/wizard.ts` controller,
`onboarding/public-contracts.ts`, private bindings, dependency planner,
read-only doctor, and `lifecycle/{planner,executor,journal,receipts}`.
Extend these seams instead of introducing another executor, journal,
acceptance ledger, routing catalog or secret store.

Initial dependency baseline is the existing install-surface manifest:
Bun `1.3.5`, OpenTUI `0.5.11`, AJV `8.20.0`, TypeScript `5.9.3`.
These are source pins, not a claim that the observed host uses exactly those
versions. Compatible changes require a separate lockfile review.

## Product boundaries

The lifecycle core is callable through JSON without a TTY. The TUI and agent
surface consume the same view/action contract. Optional Speculum and native
apps remain projections. Headless recovery works when all glass is absent.

The current sequential seven-step onboarding flow remains the first-install
entry. Add an operations workspace for recurring machine, module, handoff
and recovery work. Do not replace first install with a dense dashboard.

No first-release cloud controller, encrypted secret-sync service, provider
proxy, universal native-session importer, or automatic router cutover.
Cloudflare resources remain remote and independently authorized. New-Mac
installation does not deploy Cambium, activate OpenAI MCP, send a message,
publish content, or enable paid connectors.

## Profiles and composition

| Profile / pack | Includes | Excludes by default |
|---|---|---|
| `workstation` | Core, selected native clients, selected project tooling, local recovery | Fleet controller and automatic background provider jobs |
| `always-on-node` | Core, explicit worker/coordinator role, service recovery and resource limits | Desktop apps, full vault, media/native-build tools |
| `recovery` | Read-only inventory, bundle verification, journal reconciliation | New task dispatch and automatic mutations |
| `browser-worker` | Pinned browser tooling, approved access and concurrency budget | Messaging or account mutation authority |
| `media-worker` | Selected codecs/tools, storage limits, approved provider references | Generation spend or publication by mere installation |
| `native-build` | Selected Rust/Xcode/signing prerequisites | Signing identity transfer without owner action |
| `noesis-personal` | Approved private bindings and memory references | Public export of personal contents |
| `cambium-ecosystem` | Selected organ contracts, project/work identity, bounded owner-read adapters and evidence joins | D1 writes, paid/public delivery, new Telegram routes or held-organ activation |
| `factor` / other approved reference packs | Scoped catalog/loadout and selected project refs | External product installation, brand permissions or connector authority by inheritance |

Snow Gloves OS is an external product, not a profile pack. The default
Temperance release includes no Snow Gloves runtime or catalog dependency.
Both `workstation` and `always-on-node` compose when Snow Gloves is absent;
removing Temperance does not remove Cambium or Snow Gloves files or services.

Composition must report dependencies, conflicts, exact source pins, required
human steps and resource constraints. Reject cycles, duplicate owners,
overlapping target paths, incompatible runtimes and port collisions before
mutation. Separate per-project Node environments cover the current Node
22 versus Node 26 requirements.

## Portable definitions and private bindings

Portable definitions carry logical module/project IDs, source repository,
revision/artifact digest, supported platforms, dependency IDs, adapter kind,
installation/configuration/health probes, resource bounds, data class and
rollback policy. References join to existing owner registries; they do not
duplicate model catalogs or canonical WorkObjects.

Extend versioned existing contracts with migration fields through the owner;
the review's evidence JSON is a snapshot, never a runtime catalog. A closed
version envelope distinguishes schema major/minor and negotiated capability.
Unsupported major versions hold effects and return `upgrade-required`.

Private bindings resolve the chosen home, workspace volumes, state roots,
service binaries, endpoints and credential references. Keep them local with
restrictive permissions; the portable export contains requirements and
redacted references, not values. Destination paths are newly chosen and
verified. Logical work identity is separate from a native client or
path-derived local project identity.

A recoverable configuration generation binds release digest, module lock
digest, binding schema/version and private binding preimage digest,
rendered-config hashes and the owned transaction. Rollback restores the
compatible release and binding generation together, or holds for manual
recovery. A missing backup is not permission to substitute current values.

An ecosystem binding additionally identifies the owner, exact contract
version/digest, WorkObject/tenant scope, plant/door, input dependencies,
effect class, artifact/consumer references, verification and freshness.
Keep these references joined to existing registries. Source metadata or an
enrollment flag cannot issue authority on another machine. The current
Thoughtseed map adapter requires a reviewed exact configuration fingerprint;
the TUI must expose that boundary rather than treating explanatory HTML
and effectful enrollment JSON alike.

The current source join has eight Cambium topics and nine in the Hermes
owner contract, including Adytum. Render Adytum as `source-parity-held`
until owner versions and consumers reconcile. All four capability-hit modes
remain disabled. Static console health labels are dated projections.

## Router choice

`router_backend` is explicit: existing supported distribution 9router or
personal OmniRoute. An unsupported personal adapter displays held and
creates no router effects. Do not inherit the core catalog's 9router
preselection into the personal migration profile.

Each endpoint has one lifecycle owner. Both currently use default port
20128; occupied ports stop setup. Independent plants on separate hosts or
endpoints can coexist. Any transfer of a shared scheduler, execution queue
or writer uses a lease/epoch fence and authoritative acknowledgment.
An OmniRoute-to-9router replacement is a separate exact-plan operation.
Do not read or copy live SQLite as a generic backup, transfer OAuth stores,
or configure fallback as a side effect of installing the kit.

## State and evidence

| Dimension | Meaning |
|---|---|
| Discovered | Source declaration or observed local candidate exists |
| Installed | Exact selected artifact exists and matches integrity checks |
| Configured | Expected owned configuration generation reads back |
| Authentication | Missing, pending-human, expired, verified or unknown |
| Admission | Selected role/scope has current authority and capacity |
| Runtime | Stopped, running, unreachable or unknown |
| Verification | Required behavioral probe passed with fresh evidence |

These are independent dimensions. One module can be installed/configured,
running, authentication-pending, admission-held and unverified. Render that
combination honestly. A valid projection's exit code is not profile readiness.
Freshness and expected version are attached to each evidence item.

Operation states extend existing lifecycle outcomes: planned, awaiting-human,
in-progress, committed, incomplete, unknown-effect, rolled-back and
manual-recovery. Only registered safe reason codes reach JSON/TUI output.
Do not embed arbitrary command strings, provider errors or runtime logs.

## Lifecycle and data flow

Proposed command family uses `temperance migrate` to avoid changing existing
install/update/rollback command semantics:

```text
temperance migrate inspect --json
temperance migrate export --manifest-only --output BUNDLE
temperance migrate diff --bundle BUNDLE --host-binding BINDING --json
temperance migrate plan --profile workstation|always-on-node --json
temperance migrate apply --plan PLAN --reviewed-digest DIGEST
temperance migrate resume --operation ID --reviewed-digest DIGEST
temperance migrate status --operation ID --json
temperance migrate rollback --operation ID --reviewed-digest DIGEST
temperance doctor --report v2 --section install --json
```

These new migration commands are a proposal, not implemented commands.
Existing `onboard`, `doctor`, `install`, `update`, `uninstall`, `rollback` and
`receipt` are retained.

Inspect defaults to bounded read-only local metadata, without port calls,
authentication refresh, provider jobs, environment dumps or log scraping.
Explicit deeper probes have a visible effect class. Export is manifest-only
by default and writes only to the explicitly requested output. Selected
private restore/WIP artifacts require separate allowlisting and encryption.

The plan binds destination identity, source/lock/binding digest, intended
effect class, dependencies, preimages, verification and rollback. Recheck
those immediately before effects. Locks prevent competing local operations;
fences protect cross-node writers. Changes after review invalidate approval.
Follow existing prepared-surface protocols and strengthen them where fault
injection exposes gaps; do not reinterpret journal markers as physical proof.

On interruption, read persisted intent and compare actual owned state.
Matching bytes reconcile; conflicting bytes hold. Unknown remote outcomes
reconcile at the owning service using the original operation/idempotency
identity. Never treat Ctrl-C or a timeout as proof no effect occurred.

## Workstation replacement

1. Inspect old host; export only a reviewed capability manifest. Classify
   approved worktrees/WIP, private settings and durable receipts separately.
2. On the new Mac, complete the trusted manual entry: Apple setup/login,
   administrator steps needed for selected tooling, verified release access.
   Do not assume Git, Bun, Homebrew or an agent CLI already exists.
3. Inspect destination; select workstation profile and desired modules;
   map new paths and review exact changes, backups and held requirements.
4. Install pinned core and selected tooling through owned adapters.
   Authenticate clients/providers independently; retain installed-but-awaiting-
   authentication as a recoverable state.
5. Attach approved projects/knowledge, reconcile unresolved work, and run
   synthetic probes followed by separately approved real canaries.
6. If a shared scheduler moves, fence old execution, acknowledge new owner,
   then resume. Keep the old machine recoverable until destination restore,
   cold boot and golden paths pass; retirement is a separate operation.

## Always-on node addition

1. Inspect the new Mac and choose worker versus coordinator explicitly;
   measure RAM, disk, OS, network and workload before setting concurrency.
   This is a Temperance node role; Snow Gloves installation or enrollment
   is not required and its fleet plans are not adopted by this flow.
2. Install only its selected role packs; authenticate or enroll with a fresh
   device identity and least-scoped credentials.
3. Attach to the chosen router/control endpoint without copying Mac-local
   paths, remote server loopback URLs, native stores or live leases.
4. Keep existing coordinator and schedules authoritative. Duplicate writers
   remain blocked until one explicit ownership transfer is accepted.
5. Test user-agent/system-daemon choice, FileVault unlock, login/keychain,
   power/sleep, service ordering and remote recovery on the physical node.
6. Prove one bounded job, stop/late-result exclusion, disconnect recovery,
   rollback and capacity limits before a soak or extra nodes.

## Durable handoff

Transfer logical work ID, approved source and plan digests, accepted artifact
references, unresolved effect IDs, environment requirements, and scope.
Exclude vendor session IDs, process IDs, authentication and prompts. The
destination validates the packet, provisions its own environment and
credentials, obtains current admission, and acknowledges receipt before the
source releases shared ownership. Offline or unknown source ownership holds
duplicate execution. Queues can deliver more than once; local replay
protection is not a claim of remote exactly-once execution.

## Rich TUI experience

The default setup asks: replace workstation, add node, or recover an
operation; then presents compatible profile packs. Existing onboarding steps
remain available for detailed provider/module setup. Operations navigation
is Ecosystem, Organs, Work, Knowledge, Machine, Modules, Access, Services,
Handoffs and Recovery. Work contains selected project and WorkObject views.
The initial setup stays guided; these views support inspection after setup.

Ecosystem shows typed connections. Organs shows five operating and six
cognitive organs, inputs, refusal bounds, triggers, artifacts, consumers
and independent verdicts. Will's six desks are role filters. Knowledge
shows canonical references and derived indexes with source/version/freshness;
it neither copies vault bodies nor promotes learning. Mac plant, Hermes
plant, Phloem and Clio are distinct bindings. A read-only adapter is an
explicit selected capability, not a hidden provider refresh or new writer.

Each list row shows requested state, actual evidence, age and a plain reason.
The right panel explains dependencies, owned paths, source/installed versions,
human steps and the next enabled action. Filters include required, optional,
held, drifted and unverified. Search and keyboard navigation work without a
mouse. Width 80 uses one panel; 120+ uses list/detail. Color is supplementary.

```text
TEMPERANCE SETUP       Add node / worker       SOURCE: verified release
Ecosystem  Organs  Work  Knowledge  Machine  Access  Recovery
----------------------------------------------------------------------
Connection                Source     Destination     Behavioral proof
Cambium admission         pinned     selected        unknown
Hands / Mac workspace     pinned     not bound       held
Adytum / Hermes topic     drifted    unattached      held
Cortex / Nutrix learning  scoped     not selected    unknown

Selected: Hands / Mac workspace
Needs: admitted task, ISA/GSD phase, loadout, destination environment.
Next: inspect owner binding; prepare a reviewable configuration diff.
Last artifact: absent. Consumer acknowledgment: absent. Verdict: absent.
----------------------------------------------------------------------
Enter details   / search   d diagnostics   ? help   Esc back   q close
```

Review displays actual operation/source/binding digests, intended changes,
preimages, irreversible human/provider effects, verification and rollback.
Final action labels are concrete. Selection alone never applies changes.
Cancel preserves completed external sign-ins and explains their independent
owner; it does not falsely promise an undo. The UI cannot become its own
approval authority. Agent mode returns enabled actions and required human
handoffs; automation cannot approve itself.

Recovery is a first-class screen: interrupted operation, last durable step,
observed state, resume/rollback/manual recovery choices and evidence.
Logs contain bounded local operator events; diagnostics are an allowlisted
report, never raw provider logs, environment values or session exports.

## First proof and release gates

Before export, prove an inspectable synthetic task chain through Cambium
admission → Temperance/Vestibule → Taste/Hands → Mac workspace → artifact
and independent verifier → Cambium receipt → Cortex/Nutrix proposal.
The company-agent variant uses Hermes/Phloem instead of a Hands workspace.
Fixtures prove contracts only. A physical destination must later prove the
same owner-bound joins with actual callback and consumer evidence. Both
profiles retain remote state and remain independent of Snow Gloves.

First prove manifest-only inspect/export/diff on synthetic roots, then one
digest-bound owned-file lifecycle transaction in a disposable directory.
Interrupt it around each journal/rename boundary, restart, reconcile, and
rollback exact preimages. Include binding/source drift, symlinks, duplicate
writers, incompatible schemas and unavailable native TUI assets. Headless
results must equal TUI actions and leave the terminal restored after exit.

Next, a separately authorized existing-Mac read-only inventory can exercise
the adapter against reality. One physical fresh Mac then proves bootstrap,
selected capability readiness, power/login recovery and restoration. Neither
source tests nor HTTP health substitutes for those gates. Remote enrollment,
secret sync, fleet soak and router cutover are separate later tranches.
