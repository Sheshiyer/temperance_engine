# Runtime dependency declarations

Fragment and lock v1 accept optional `requires`, at most 32 unique closed declarations. Binary requirements name bounded ASCII basenames, not paths, options or shell expressions. Missing or empty declarations preserve existing behavior.

`http-health` recognizes an uppercase symbolic `url_token` as metadata but is held with `DEPENDENCY_HTTP_UNSUPPORTED` before resolving endpoints or probing any dependency. Endpoint ownership, fixed HEAD/redirect policy, finite deadlines and response cancellation require a separate contract; destination roots are not URL bindings.

The executor snapshots and validates declarations for planned records only before any probe or journal creation. Optional unavailable binaries remain skipped; explicit selected/scoped unavailable binaries hold. Dry-run validates declarations but performs no probes. Direct hazard entrypoints validate their supplied record set before any binary probe. Callers must supply only their selected scope.

The outer record DTO and injected IO implementations remain trusted and caller-bounded. Declaration validation rejects proxies/accessors but does not prove arbitrary outer-object allocation limits, native binary identity, execFile output/deadline bounds, capacity or runtime suitability. A found PATH binary is availability evidence only. No existing record gains requirements. Consumer source publication requires later explicit COPY expectation reconciliation; this unit does not repin inventories.
