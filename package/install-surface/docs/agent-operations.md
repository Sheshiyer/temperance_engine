# Agent and human operator flow

The modular migration CLI and TUI use the same validated controller view and
action contract. Source Tasks 1–6, including the TUI and split production build,
are accepted with bounded disposable-runtime evidence. The source includes no
default production owner. Final Task 7 immutable-artifact/runtime qualification
and Task 8 physical acceptance remain pending. Physical migration is a separate
owner-approved gate, not a source-product completion prerequisite. Keep source,
compiled-fixture, final-artifact and destination-readiness claims separate.

## Migration command grammar

After independent kit verification and bundled-runtime checking, invoke the
compiled entry from the kit root:

```sh
./toolchain/bun-1.3.5-arm64 package/install-surface/dist/cli.js migrate --json
./toolchain/bun-1.3.5-arm64 package/install-surface/dist/cli.js migrate --snapshot "$PUBLIC_SNAPSHOT" --json
```

The accepted action grammar is below. Uppercase values denote explicit references
or a valid operation ID/digest, not filenames that the CLI automatically trusts.

```text
migrate [--snapshot FILE] [--json]
migrate inspect [--json]
migrate export --manifest-only --output REF [--json]
migrate diff --bundle REF --host-binding REF [--json]
migrate plan --profile workstation|always-on-node|recovery [--json]
migrate apply --plan REF --reviewed-digest sha256:HEX [--json]
migrate status --operation TXID [--json]
migrate resume --operation TXID --reviewed-digest sha256:HEX [--json]
migrate rollback --operation TXID --reviewed-digest sha256:HEX [--json]
migrate release --operation TXID --reviewed-digest sha256:HEX [--json]
migrate cancel [--json]
migrate request-sign-in [--json]
```

The CLI additionally admits `migrate [--snapshot FILE] --tui`.
It refuses `--tui --json`, action-plus-TUI forms, unknown/duplicate flags and the
literal `view` subcommand. Snapshot loading is available on the bare view form;
it is not a general flag for actions. There is no shell installer `--profile`
flag, CLI owner-file flag, migration module-selection flag or migration project
approval flag.

| Action | Effect and production boundary |
|---|---|
| Bare view / explicit public snapshot | Public projection; no host discovery or owner creation |
| Inspect, diff, plan, status | Read-only owner operations; held when required ports/inputs are absent |
| Export | Local manifest write through an explicit owner seam; never label it read-only or a full data backup |
| Apply, resume, rollback, release | Reviewed local transaction requests using the existing lifecycle executor and fresh owner checks |
| Cancel | Cancels the current controller operation and observes settlement; a new CLI process does not control another process's transaction |
| Request-sign-in | Human handoff only; authentication is not performed |

The production CLI provides no inspection/export/comparison/planning/recovery
owner ports. Valid grammar therefore does not imply those actions can execute.
They report held conditions such as `OWNER_ADAPTER_UNAVAILABLE`. Profile selection,
viewing, cancellation and handoff cannot manufacture missing authority.
`--host-binding` in a migration diff is an opaque owner-resolved reference to a
comparison target; it does not instruct the CLI to load a private host-binding
file or reinterpret one as a public target.

## Read the validated result

Parse `temperance.migration.view.v1` JSON rather than scraping terminal text.
Inspect `command`, `outcome`, `effect_class`, findings, action availability,
handoffs and operation identity together. Evidence dimensions remain separate;
a supplied source snapshot does not become observed destination evidence.
An enabled action is an available request interface, not authorization.

Exit 64 means invalid arguments/input/projection; 2 covers manual recovery or
unknown effects and unverified terminal results. Exit 0 covers completed view
operations and verified terminal results under the controller's action-specific
rules. Other held, awaiting-human, cancelled or incomplete outcomes use 1.
Release succeeds only with its current released/VERIFIED result. A historical
committed or rolled-back operation must not override a currently uncertain or
refused request. An exit code alone is insufficient to decide the next action.

The safe Review projection carries exact plan/source joins and step requirements,
historical final-review status and any separately acquired release-only context.
Its review validation is structural; freshness and independently observed release
evidence are not certified by displaying them. `execution_authorized:false`
remains explicit. Backup inventory, last durable step and restoration verification
are not exposed by this owner API and must stay UNKNOWN. An external test's disk
observations cannot silently become new public ABI fields.

## Trusted integration and recovery

An embedded trusted host can supply the existing `MigrationOwnerPorts` in code.
The production CLI has no JSON/file option that constructs those ports. Keep
independent source pins, complete planner inputs, final review, exact operation
txid/claim nonce, owned steps and root/binding identity outside returned view
objects. Matching returned plan digests, file possession and UI consent are not
an authenticated owner decision.

Each request resolves its operation and final review independently. Recovery
reauthenticates the requested action and rereads fresh inputs/current destination
facts through the existing authority and IO seams. Unknown remote outcomes,
changed release/module-lock/binding/configuration-generation identities, foreign
preimages and stale reviews hold. The controller forwards recovery to the
existing executor; the journal, receipts, prepared outputs, custody records and
preimages remain the transaction evidence. Do not add a parallel journal or
execute a plan by scraping its presentation.

Repeat apply on an existing txid is refused by `TRANSACTION_EXISTS`; do not treat
that hold as repeated success or mint a new txid to evade it. Status/resume
reopen the retained operation. Compatible rollback requires authenticated prior
state and actual matching preimages/modes; a shell backup or current file with
matching bytes alone is insufficient. Unsupported atomic no-replace custody
remains an explicit hold rather than a check-then-rename fallback.

After original review expiry, terminal release requires a fresh independent
release-only context bound to the original review, plan, txid/nonce, state root
and current terminal evidence. It does not renew mutation authority. Repeated
release must preserve terminal artifacts. Refusal, interrupted response or
unknown effect requires reobservation/reconciliation, not blind replay.
External sign-ins remain separately owned and are not reversed by cancellation
or rollback.

## TUI and profile scope

The TUI’s ten sections are Ecosystem, Organs, Work, Knowledge, Machine,
Modules, Access, Services, Handoffs and Recovery. Both base profiles share the
same model; `recovery` provides a recovery scenario with apply disabled.
Selected destination, retained snapshot and retained plan profiles are distinct.
The six Will desks are display filters, not new agents or scheduling grants.
Module toggles and a complete project inventory are not exposed. Missing
required/optional/drift and recovery facts remain UNKNOWN.

Follow only displayed enabled action IDs. Enter/confirmation requests the shared
controller action and still requires fresh owner checks. Ctrl-C and pending-action
cancel await actual settlement. If a TTY or native renderer is unavailable, the
entry emits `NATIVE_TUI_UNAVAILABLE` and suggests the JSON/status forms; it does
not create an owner, report restoration or certify a service. Accepted compiled disposable cases exercised Help/resize anchors and native
fallback; final immutable-kit qualification remains pending. Full Review and
individual filter choices have source/TestRenderer coverage, while the actual
rich cases visited the Filter menu without selecting every value. SIGKILL, lost
PTYs and power loss do not imply cleanup. See the [bounded Task 6 evidence](../../../docs/modular-mac-lifecycle.md#accepted-task-6-evidence-and-its-limits)
for descriptor observation limits and the separate interrupted-operation reopen
cases. Closed-channel terminal state remains unavailable; no restoration is
inferred from headless recovery.

The reviewed growth contract preserves source lineage, independent consumer
verdicts/freshness and Adytum topic-parity holds. Capability-hit modes stay
disabled. Snow Gloves is an external nonauthorizing reference, excluded from
both base profile selections. None of these references is provider, device,
enrollment, publishing or learning-promotion evidence.

## Legacy onboarding agents

`onboard --agent` and `onboard --tui` share the existing sequential wizard,
its action IDs and dependency gates. They have a different contract from
`migrate`. In a reviewed source environment, existing forms include:

```sh
bun src/cli.ts onboard --agent
bun src/cli.ts onboard --agent --step host --action continue
bun src/cli.ts onboard --health --json
bun src/cli.ts onboard --logs --json --limit 50
bun src/cli.ts doctor --report v2 --section install --json
```

These examples run from `package/install-surface` with the reviewed toolchain.
Use the same explicit catalog/profile/binding/project-capsule/preference inputs
when returning to that wizard. `--project-capsules-out` enables a potential save
destination only for TUI/agent; agent projection does not itself persist approvals.
Do not pass profile inputs to `--logs` or reuse wizard state as migration authority.

Read returned `steps`, `step`, `state` and enabled `actions`. Carry returned
`state.step` through `--step`, candidate IDs through `--project-select`, and
requested modules through `--select` on the next legacy call. `--select ,`
represents an explicitly empty request. Navigation is transient; fresh dependency
planning governs selection/deferral. Stop at `handoff.status=required` for
provider sign-in, exact combo review, project saving or final confirmation.
Use an owned supported PTY only for explicitly authorized human interaction.

Legacy `--agent` exit 0 means a valid projection, even with disabled actions or
handoffs; `--health` exit 0 means its required configuration checks passed and
1 means held/unavailable. Invalid arguments/actions return 64. Neither result
is modular migration admission, actual organ/service operation, or session
capacity proof. Existing personal composition stays an explicit private input;
it does not implement the shell installer's held personal-overlay adapter.

Legacy `--telemetry` opts into bounded local event metadata for TUI/agent/health.
It records fixed event/action labels, counts, timing and a random run identifier,
not prompts, project paths, credentials, callback addresses or provider/model
bodies. Logs use owner-only directory/file permissions, a 1 MiB/4096-event ring
and no network destination. `--logs` is read-only and rejects unsafe/malformed
files; `--limit` accepts 1–200 and `--run` filters a run identifier. Optional
telemetry failure is reported separately. These events are not owner grants or
transaction recovery receipts, and these telemetry flags are not migration flags.

## Evidence boundaries

Use the [bootstrap guide](guided-onboarding.md) and
[lifecycle guide](../../../docs/modular-mac-lifecycle.md) for the actual minimal
skip/preserve command. It creates absent generic surfaces only; it does not run
full Node-dependent repository verification or select a migration profile.
Legacy optional source installation retains broader update/backup behavior.

The historical enrichment COPY mismatch was resolved in reviewed foundation
source; private `atlasRecall.ts` remains excluded. That foundation archive is not
the final integrated kit. Keep exact committed source A, complete split build and
dependency closure, outer archive hash and independent verification identities.
An external qualification receipt B names A's immutable artifact; no rebuild is
needed merely to include B's acceptance wording. A real source fix requires a
new reviewed commit, build and digest.

`verify.sh`, broader source/shell-mock suites, strict static checking, compiled
entry checks, archive validation, actual extracted-kit/SDK/PTY cases and physical
acceptance are separate evidence. Local mocks do not demonstrate live providers;
fictional owner harnesses do not demonstrate a shipping production owner. Final
Task 7 cases still await final source/artifact admission and qualification.
Task 8 target/access, identity, cold boot, FileVault, callbacks, power/network
recovery and actual backup/restore remain owner-operated physical gates.
