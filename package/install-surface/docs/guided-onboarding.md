# Guided onboarding

`onboard --tui` is a sequential wizard, not a tabbed dashboard:

1. Host — review the machine and explicitly selected personal profile, if any.
2. Projects — inspect existing approvals and mapped folders/repositories; select new approvals explicitly.
3. Providers — choose a provider and complete 9Router-owned sign-in.
4. Combos — select ordered live model members for each alias, then review the exact 9Router changes.
5. Organs and tools — request capabilities, re-probe dependencies, or explicitly defer held options.
6. Integrations — review application prerequisites without treating presence as live service health.
7. Review — confirm requested configuration and project approvals with Enter or y.

Use the arrow keys to choose a visible action and Enter to activate it. Back and
Continue are ordinary action rows. OAuth, combo setup, and refresh return to the
current step with pending selections preserved. Cancel does not save pending
project or module choices; completed provider authorizations are owned by
9Router and are not undone by cancelling the outer wizard.

## Persistence and authority

- `--project-capsules` loads approved project access; `--project-capsules-out` explicitly enables saving new approvals. Existing capsules are preserved.
- `--wizard-state` loads/saves owner-only requested-module preferences for this profile. Every launch re-probes; saved preferences are not admission or activation grants.
- Provider sign-in requires an explicit provider action. Credentials stay in 9Router.
- Combo setup currently supports a fresh combo/key state with existing OAuth providers. Existing combos, gateway keys, and occupied Keychain references are held, not overwritten.
- Seating choices alone do not authorize writes. A separate exact-plan review binds ordered members, alias mappings, and the gateway reference into the apply digest.
- Final wizard confirmation does not install every selected organ, certify a tunnel/dashboard, or establish 900k–1M context capacity. Those capabilities need their own operational evidence.

Generic Temperance needs no Noesis profile, mounted personal volume, or provider.
Personal paths and Keychain references belong in the explicitly supplied private
host binding, not in the portable core.
