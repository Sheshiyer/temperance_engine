# Temperance Engine engineering contract

Read `PROJECT.md` and the current structured handoff before changing source. Select only the continuation relevant to the requested task.

- Keep the neutral engine client- and flow-agnostic. Consumers select their workflow, adapters and owners.
- Repository engineering acceptance remains in `ISA.md`; finite implementation work remains under `.planning/`. Runtime planning, authorisation and acceptance owners are interfaces.
- Keep client, Alchemy and infrastructure presets in explicitly selected compatibility modules or profiles. Noesis Cambium is a separately versioned personal consumer.
- Preserve v1 APIs through explicit compatibility entry points. Use versioned neutral contracts for changed shapes.
- Reuse the existing composition, transaction, dependency, cancellation, replay and receipt mechanisms. Introduce no second planner or approval ledger.
- Keep private context, credentials, native identifiers, prompt/response bodies and machine-specific checkout paths out of tracked artifacts.
- Use isolated branches; preserve concurrent dirty work and the installed host. Source changes grant no native trust, provider configuration, service activation, tenant admission or release.
- Keep original upstream names and ownership. Resolve optional skills on demand from their indexed sources.
- Use PROJECT's commands and checks for the changed boundary. Record source, installation, actual runtime and acceptance evidence separately.
- Add no bridge, scheduler, resident organ or new hook family.

Historical PAI/client setup remains available through explicit v1 compatibility surfaces. It does not prescribe a runtime flow for the neutral core.
