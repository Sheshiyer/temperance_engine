# Temperance Engine

Temperance Engine is a client- and flow-agnostic operator engine. Its neutral entry point is `package/install-surface/src/engine.ts`. The standalone doctor is `package/install-surface/src/composition/engine-cli.ts`.

Profiles select clients, external workflows, modules, services and policy. `Sheshiyer/noesis-cambium` is a separate personalised consumer, not an engine dependency. The six organs are an optional public module pack.

## Pickup

Read `AGENTS.md` and select the current fields and matching continuation from `.planning/HANDOFF.json`. Open only its cited plan or proof. This repository's ISA and GSD state govern engineering work; consumer planning and acceptance owners are configured through interfaces.

## Commands

```sh
bun package/install-surface/src/composition/engine-cli.ts doctor --json
cd package/install-surface
bun install --frozen-lockfile
bun run typecheck
bun test test/engine-v2.test.ts test/engine-adapters-v2.test.ts
bun run build
```

`VERSION` remains the published baseline. Source and fixture checks do not qualify a new release or a personal installation. Preserve the existing v1 interfaces and historical qualification evidence.
