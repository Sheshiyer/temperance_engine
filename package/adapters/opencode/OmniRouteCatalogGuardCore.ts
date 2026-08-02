// Relocated to package/router/omniroute-catalog-guard.ts (2026-08-02) so
// temperance-openai-proxy.ts's explicit-picker path can share the same
// fail-closed live-model guard without depending on this adapter package,
// which is slated for retirement once Paseo's native provider path replaces
// OpenCode (see docs/superpowers/specs/2026-08-02-omniroute-paseo-native-routing-design.md
// Phase 5). This file re-exports the shared implementation so
// OmniRouteCatalogGuard.ts and its existing tests keep working unmodified
// until that retirement.
export * from "../../router/omniroute-catalog-guard"
