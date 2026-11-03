# Neutral engine v2 source preview

Temperance Engine is the generic glove. A selected profile is the hand. A client adapter, an external workflow and a set of optional modules meet through versioned contracts. Noesis Cambium is one personalised consumer in a separate repository.

## Start without a profile

Requires Bun. Run from the source checkout:

```sh
bun package/install-surface/src/composition/engine-cli.ts doctor --json
```

The report has `readiness: core-available`, an empty module list, null client and flow references, and no effect or acceptance authority. The command reads its explicit input and writes a report. It starts no provider, client or service. No personal profile is imported.

## Public interfaces

Import the neutral API from `package/install-surface/src/engine.ts`. Import optional modules separately.

| Contract | Responsibility |
| --- | --- |
| `temperance.composition.v2` | Plant identity, optional coordinator and flow references, runtime owners, selected descriptor pins and capability bindings |
| `temperance.module-descriptor.v1` | Implementation pin, declared dependencies and named read/write operations |
| `temperance.composition-observations.v2` | Fresh, plant- and manifest-bound capability observations |
| `temperance.work-request.v2` | A caller-selected run, flow, step, module and operation with scoped input |
| `temperance.owner-action-plan.v1` | Exact task, target owner, operation, input digest and source binding presented for approval |
| `temperance.work-receipt.v2` | Process result, actual owner references, persistence and uncertain outcomes; never semantic acceptance |

`inspectCompositionV2` validates selected descriptor pins and dependencies. `invokeModuleV2` invokes exactly one caller-selected operation. It never selects a next step, retries an effect, chooses a model, or interprets phase names. The external workflow supplies ordering, branching, attempts and stop rules. Arrays and exact text bytes remain significant in neutral action digests.

A profile supplies the planning and acceptance owner references. ISA/GSD remain the engineering owners of this source repository, rather than compulsory services for every consumer.

For example, inspecting an explicitly selected pack needs no client or workflow:

```ts
import { createBareComposition, inspectCompositionV2 } from "../package/install-surface/src/engine.ts";
import { createOrganPack, pinOrganDescriptors } from "../package/install-surface/src/modules/organs.ts";

// The consumer loader verifies this hash against the reviewed installed source.
const pack = createOrganPack(verifiedOrganSourceDigest);
const composition = {
  ...createBareComposition("example-plant"),
  modules: pinOrganDescriptors(pack.descriptors),
};
const report = inspectCompositionV2(composition, pack.descriptors);
// Selected modules remain held until their configured owner capabilities are observed.
```

To perform work, the caller also supplies its flow reference, capability bindings, fresh observations, a durable ledger and pinned trusted handlers/owners. `WorkRequestV2.step_ref` can be `review`, `restore` or any symbolic identifier chosen by that external workflow. Pass `signal` to cancel an invocation. Cancellation after dispatch requires owner readback. It is not proof that an action stopped.

## Optional modules

`src/modules/organs.ts` supplies all six owner-backed handlers: Vestibule (orientation), Adytum (interpretation), Nutrix (outcome learning), Auspex (health/recovery), Circulator (review/digest), and Praeceptor (improvement/proposal decisions). The pack is absent from the neutral entry-point import graph.

Profiles select the pack and bind its declared capabilities to actual owners. The handlers check subject identity, evidence attribution, distinct memory planes, verified-outcome delivery, provisional proposals, reviewed promotion and recovery readback. They do not invent those results or provide an inference backend. Missing owner bindings remain held. A role handler passing fixtures does not establish a working personal binding.

Organ inputs contain `subject_ref`, `evidence_refs`, `proposal_ref` and `action_ref`. Unused proposal/action references are explicitly null. Recovery requires a named action, and promotion/rejection requires the exact proposal. The owner's output binds those same identities plus `kind`, distinct `planes` and `disposition`.

A verified outcome uses `verified-recorded`. A draft proposal uses `proposed`. Promotion uses `reviewed-promoted`. Profiles bind verified delivery and provisional proposals to their separate existing stores.

`src/modules/clients.ts` supplies optional Codex CLI and Claude Code signal normalisers and official-package guidance. An external workflow supplies the event mapping. Already-redacted occurrence references are required. Raw native envelopes and conversation bodies are refused. These functions install no subscriptions. Installation guidance requires an exact version and integrity pin.

`src/modules/installation.ts` bridges the neutral action interface to the existing onboarding executor and durable receipt store. The installation owner must resolve a confirmed immutable plan and re-observe its target, versions and preimages. Its effectors retain immediate drift checks and compensation. A stored receipt must be read back before the adapter reports completion.

## Authority, recovery and evidence

Write operations require the configured authorisation owner to approve the exact plan and task before expiry. Profiles can implement task-scoped approval once without introducing per-command prompts. The engine does not maintain another approval store.

A durable atomic ledger owns claims. The optional filesystem ledger uses exclusive claims and atomic receipt creation. Claims survive interrupted runs. The engine never releases or replays unresolved work automatically. Receipt persistence failure and unsettled callbacks remain uncertain. Query the same owner with `readOwnerActionStatus` before considering a new action.

Injected handlers, owners, authorisation and storage implementations are trusted adapters, not a sandbox. The target loader must check registration pins against installed source. Configuration hashes do not authenticate a process or grant permission. Source inspection, installation, observed runtime and owner acceptance remain distinct.

## Compatibility and profiles

The explicit `composition/compatibility-v1.ts` entry point retains the earlier client/organ contracts and lifecycle API. The reviewed seven-phase prototype and read-only Vestibule provider remain compatibility source, rather than imports of the neutral engine. Existing v1 installer and onboarding commands remain available for deliberately selected legacy profiles.

Noesis owns its adaptive Alchemy/GSD flow, mandatory OmniRoute and memory, task-scoped policies, personal readers and host bindings. It pins the engine source or release independently and must qualify its own installed adoption. Public-engine acceptance is independent of that private profile. Adding a source consumer preserves the installed personal runtime.

## Qualification

Release 0.8.0 remains the published baseline. The v2 API is a source candidate. Local checks cover neutral startup, non-Alchemy external flows, all six configured handlers, versioned compatibility, owner authority, replay, timeouts and disposable installation recovery. The local platform and exact client versions are recorded in the evidence receipt.

The initial portability matrix is macOS Apple Silicon and Intel, Linux x64 and native Windows x64. Codex CLI and Claude Code are the first optional client targets. CI source checks and version probes do not establish authenticated native callbacks, actual personal bindings or complete clean-host acceptance. Missing platform, callback and installed-owner evidence remains open. No release or public launch follows from fixture success.

`.github/workflows/neutral-engine.yml` runs standard disposable targets and records exact observed versions. Its pinned official npm-package installation route follows the [Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli) and [Claude Code npm setup](https://code.claude.com/docs/en/setup#install-with-npm). Runner labels follow the [GitHub standard-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). The receipt script never authenticates a client or starts a model session.
