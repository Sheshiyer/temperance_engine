# Neutral engine source candidate

The approved generic-glove architecture has a versioned source implementation. Public release acceptance remains held. VERSION stays at 0.8.0.

The neutral entry point exports composition, module descriptors, capability inspection, caller-selected work, attributable owner actions and durable receipt interfaces. External workflows own sequence, branches, retries and stops. Optional modules provide all six organ handlers, two initial client adapters, official pinned installation guidance and a bridge to the existing transaction executor. Explicit v1 compatibility retains the earlier Alchemy/client behaviour.

The implementation reuses the existing callback boundary and onboarding executor. It adds no resident component, scheduler, bridge service or hook family. Trusted callbacks and storage are adapters, not sandbox isolation. A loader still has to verify declared pins against installed source.

## Verification

- Manual source integration: 285 tests passed across seventeen files, including fresh installation, interruption, rollback, receipt immutability and refusal to overwrite a concurrent edit.
- TypeScript checking and CLI bundling passed. The existing documentation gate passed across 41 scoped files without baseline changes.
- Each of the six roles covers missing dependencies, stale evidence, wrong identity, cancellation, concurrent replay, owner refusal, persistence failure and indeterminate owner results.
- Regression checks cover exact array/text hashing, immutable callback/observation snapshots, expiring approvals and external caller cancellation. A new failing check exposed receipt redirection after replacement of a claimed ledger directory. The fix binds filesystem directory identity at claim and rechecks it before persistence. A real killed-process check confirms that an interrupted claim stays held for owner recovery.
- `local-qualification.json` records bare startup and fresh disposable official-package installation/version probes on Darwin arm64, kernel 27.2.0, Bun 1.3.13 and Node v24.3.0. Codex CLI 0.166.0 and Claude Code 2.1.316 both returned the pinned version. The receipt explicitly identifies a dirty source candidate based on the inspected public main.
- The owner deferred CI. The proposed GitHub workflow was removed, and manual qualification tooling moved to `verification/`, outside the runtime package. Future Woodpecker execution belongs to separate development infrastructure on existing hardware, with no new paid resources. The declared macOS ARM/Intel, Linux x64 and native Windows x64 target matrix still requires actual evidence.

## Held gates

Observed native client callback linkage and consumer readback remain open. Complete clean-host acceptance, actual installed owner bindings and the declared portability matrix need their own evidence. No source fixture accepts those gates.

The Noesis source consumer belongs in its separate owning repository. Its installed personal runtime is unchanged. The expanded website is a separate reviewed candidate. Public launch waits for public-engine acceptance, independently of Noesis acceptance.

The existing Product Hunt listing still showed the November 6 schedule during the authenticated read. Available UI controls exposed rescheduling but no return-to-draft control. No deletion, visibility change or schedule change occurred. Unscheduling remains an external blocker.

Cambium owns the product references, bounded continuation and original historical handoff. Earlier graph rejections remain historical rejections. The original handoff measurements establish smaller selective output, with no demonstrated overall token or latency improvement.
