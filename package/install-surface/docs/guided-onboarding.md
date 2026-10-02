# Guided onboarding and modular migration

The modular migration surface, shared controller, TUI and split production build
are accepted source with bounded disposable-runtime evidence. Final Task 7
immutable-artifact qualification and Task 8 physical acceptance remain pending.
Physical migration is a separate owner-approved gate; source-product completion
does not require a physical target. The existing `onboard` wizard is a separate
legacy interface, described at the end of this guide.

## Begin with the verified kit

Obtain the verifier and its expected checksum through the reviewed channel,
check the verifier before running it, and supply an independently trusted archive
digest. The adjacent archive sidecar does not establish trust by itself.

```sh
/bin/bash ./verify-migration-kit.sh \
  --archive "temperance-engine-${VERSION}-arm64.tar.gz" \
  --expected-digest "sha256:${TRUSTED_ARCHIVE_SHA256}" \
  --extract-to "$HOME/temperance-kit"
```

The destination must be absent beneath a private parent you control. Stock macOS
Bash 3.2, Perl with the required standard modules, gzip and shasum verify the
archive without Git, Node, Bun, Homebrew or an agent client. Missing tools or
invalid archive structure hold before payload creation. Publication is exclusive
file creation, not atomic directory publication; changed destination identity
holds cleanup. See the [lifecycle guide](../../../docs/modular-mac-lifecycle.md)
for exact prerequisites, pins, bounds and publication limits.

Use the same minimal bootstrap for either intended base profile:

```sh
cd "$HOME/temperance-kit"
sh install.sh --preserve-existing \
  --skip-voice --skip-claude --skip-codex --skip-opencode --skip-cursor \
  --skip-gsd --skip-manifest --skip-relay --dry-run
```

Inspect the plan and remove `--dry-run` to perform it. This creates only absent
generic AGENTS/resolver outputs and required directories. Existing leaves are
preserved without adoption or redundant backups; linked or nondirectory parents
and unsafe sources hold. Portable-kit detection automatically enables this mode.
It skips optional client/voice/service setup and CodeGraph, and rejects force or
requested `--with-*` activation before effects. Malformed provenance, unsupported
kit platform and nonempty private-overlay requests also hold. Its success message
describes minimal bootstrap only. There is no shell `--profile` option.

Before using packaged JavaScript, check the bundled Bun binary:

```sh
printf '%s  %s\n' \
  66262f09134f780b1563bd1ae3dad13ea7d2ac669f8a5754f924b3c82abcc8f3 \
  toolchain/bun-1.3.5-arm64 | /usr/bin/shasum -a 256 -c -
./toolchain/bun-1.3.5-arm64 --version
```

Require checksum success and exact version `1.3.5`. The arm64 kit contains frozen
dependencies. Do not fetch them as an implicit bootstrap step. Other kit targets
remain held pending their independent toolchain/native verification.

## Open modular migration

From the verified kit root:

```sh
./toolchain/bun-1.3.5-arm64 package/install-surface/dist/cli.js migrate --json
./toolchain/bun-1.3.5-arm64 package/install-surface/dist/cli.js migrate --snapshot "$PUBLIC_SNAPSHOT" --json
./toolchain/bun-1.3.5-arm64 package/install-surface/dist/cli.js migrate --tui
./toolchain/bun-1.3.5-arm64 package/install-surface/dist/cli.js migrate --snapshot "$PUBLIC_SNAPSHOT" --tui
```

`--snapshot` accepts an explicitly supplied, validated public snapshot. It does
not discover the host or load a private binding/owner adapter. `--tui` cannot be
combined with `--json` or an action subcommand. The literal `migrate view`
subcommand is not accepted; bare `migrate` is the view command.

The scenario picker offers `workstation`, `always-on-node`, and `recovery`.
Both base profiles use the same modular contracts and can share the same module
selection/backend. Scenario selection is local display/controller state. It
does not rewrite the retained source snapshot, reissue a plan or choose a node's
service role. The interface labels selected destination, retained source and
retained plan profiles separately. Apply is disabled for the recovery scenario.

## Ten sections

| Section | What the supplied evidence can show |
|---|---|
| Ecosystem | Organ relationships, owner/contract/source, dependencies, trigger, artifact, consumer, verdict and freshness |
| Organs | Five operating and six cognitive organs, their separate admission/runtime/verification facts and Will role filters |
| Work | Bound work references and declared cell effects; broader project inventory remains UNKNOWN |
| Knowledge | Versioned knowledge references and freshness; no private body copying |
| Machine | Source/destination/plan context, declared toolchain needs and compatibility observations; no identity issuance |
| Modules | Logical module references and retained plan steps; module toggling/install selection is not exposed by this controller |
| Access | Separate evidence dimensions and a request-sign-in human handoff |
| Services | Supplied organ runtime/verification observations; no service probe or activation |
| Handoffs | Explicit human handoffs and supplied consumer lineage/acknowledgment |
| Recovery | Current operation and available owner actions; backup availability, last durable step and restoration verification remain UNKNOWN |

The operating organs are Genesis, Taste, Hands, Will and Cortex. The cognitive
organs are Vestibule, Adytum, Nutrix, Auspex, Circulator and Praeceptor. The six
Will desks—head-of-marketing, copywriter, creative-strategist, launch-lead,
seo-lead and analyst—filter roles inside Will; they are not new agents or organs.
Reviewed growth references retain independent source/version/digest and verdict
requirements. Missing Adytum topic-parity evidence remains a hold. Capability-hit
mode declarations remain disabled and grant no scheduling or enrollment.
Snow Gloves remains external and excluded from both base profiles.

## Navigation and action requests

Use `g` for sections, `[`/`]` for adjacent sections, `s` for scenarios, `a` for
actions, `r` for the safe Review screen, `w` for Will roles, and `f` for filters.
Arrow, Home/End and Page Up/Down keys navigate. Tab/Shift-Tab changes visible
focus; `/` searches supplied rows; Enter opens details or an explicit request.
Escape returns, and `q` backs out before closing. `?` opens help. Search and
filters change presentation only; required/optional/drifted facts remain UNKNOWN
when absent. Layout adapts between a single panel and list/detail presentation,
with per-section position and detail bookmarks.

Enabled actions request the same controller operation used by JSON clients.
Consent does not authenticate an owner or grant a fresh review. The production
migration entry injects no owner ports, so inspection, export, comparison,
planning and recovery operations are held without a trusted integration.
`request-sign-in` produces a handoff and performs no authentication. Selection
alone never installs or activates a module.

Review displays the acquired plan's source/binding joins and proposed steps,
historical final work review, and any current release-only context. A digest match
or displayed structure does not prove freshness, ownership, observed backups or
restoration. Trusted integrations must independently supply those prerequisites
when the requested action runs.

Ctrl-C asks the controller to cancel and waits for possible effects to settle.
Cancellation cannot reverse an external sign-in or make an uncertain operation
safe to repeat. Native TUI/terminal failure emits `NATIVE_TUI_UNAVAILABLE` with a
headless suggestion. Use `migrate --json` for the public view or the documented
status grammar for an owner-resolved operation; status remains held if the
production entry has no owner. Native failure is not automatically a clean
terminal-restoration or rollback receipt. Hard termination, closed PTYs and
power loss require their own evidence.

The accepted disposable compiled-TUI cases covered both profiles, all ten
sections, all six Will roles, search/focus, held owners, Help/resize anchors and
Recovery. Full Review behavior and individual filter choices have separate
source/TestRenderer coverage; the actual cases visited the Filter menu only.
Recorded terminal modes and positive dimensions matched through a bounded fresh
descriptor observation before close/drain. This does not establish shell job
control or kernel-generated Ctrl-C. The separate hard-close cases retained an
interrupted operation and reopened it in another process; terminal state after
connection loss was unavailable. See the [lifecycle evidence limits](../../../docs/modular-mac-lifecycle.md#accepted-task-6-evidence-and-its-limits).
Final archive qualification remains a separate required check.

## Legacy `onboard` wizard

`onboard --tui` retains its sequential Host → Projects → Providers → Combos →
Organs and tools → Integrations → Review workflow. It is not the ten-section
modular migration surface. Its existing explicit profile/binding, project-capsule
and preference arguments have their own contracts; they do not supply migration
owner ports or bypass the installer's personal-overlay hold.

In that wizard, arrows and Enter choose visible actions. Back/Continue are action
rows; `d`/`l` open health/local events and return to the current step. Cancelling
does not save pending project/module choices; already completed provider
authorizations remain owned by the provider adapter. Project saving requires
`--project-capsules-out`; `--wizard-state` stores requested-module preferences,
which are re-probed and never become activation grants.

Legacy provider sign-in and exact combo/key review are separate explicit owner
actions. Occupied combo/key references remain held where the adapter cannot
support them. Final wizard confirmation does not certify organ operation, service
health, session capacity or either modular migration profile. Generic Temperance
requires no personal profile, mounted personal volume or provider.

See [agent operations](agent-operations.md) for separate migration and legacy
headless grammar. Source checks, compiler checks, shell mocks, compiled-entry
checks and final archive/PTY/OS-IO qualification have distinct evidence. Final
Task 7 remains pending final source/artifact admission and qualification; Task 8
physical bootstrap, identity, recovery and backup/restore remain owner-operated.
