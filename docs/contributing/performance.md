# SDK performance (contributors)

This page is for maintainers optimizing SDK internals and framework adapters.

Performance is **not** the motivation for the Rust core — the workload is
I/O-bound and the goal is semantic consolidation (redesign-v2 non-goals). The one
place performance is a hard constraint is the browser/edge WASM footprint, which
is budgeted and enforced in CI. **Do not make unqualified performance claims
anywhere in SDK docs; cite the budgets below.**

## WASM size and cold-start budgets

Budgets live in [`rust/bindings/wasm/budgets.json`](../../rust/bindings/wasm/budgets.json)
and are the source of truth. It records, per profile (`browser`, `edge`):

- `baselines` — measured raw bytes, gzip bytes, and median cold-start ms
- `maxAllowed` — the ceiling CI enforces
- `environment` — pinned Node/OS/rustc/wasm-bindgen/Binaryen versions
- `measurement` — gzip level, cold-start definition, sample count, statistic

The **browser** gzip size + cold start is the mandatory gate (secret-key symbols
are excluded from the browser profile — see capability separation in
[architecture.md](./architecture.md)). The **edge** profile is diagnostic only.
A regression beyond the recorded threshold (`regressionThresholdPct`, currently
10%) requires approval and a documented baseline update.

## Measurement methodology

`rust/bindings/wasm/scripts/measure-wasm.mjs` produces the numbers:

- deterministic raw + gzip level-9 byte counts
- multiple isolated child processes; warm reuse discarded
- reports median + spread (median absolute deviation)
- pins Node/OS/toolchain metadata into `budgets.json`

Normal CI runs `--check` (cannot rewrite budgets). Recording new baselines
requires an explicit `--record` and a rationale in the PR.

## FFI boundary rule

Keep the language↔core boundary cheap: **≤ 1 encode per hop.** JSON bytes cross
the boundary once; no intermediate string re-encodes on a hot path. This is a
binding-code-review guideline (redesign-v2 §7.8).

## Facade-side performance (stays in TS)

These optimizations live above the Rust client, in the facades, and are unchanged
by the migration:

- request deduplication for repeated purchase checks (`createRequestDeduplicator`)
- short-lived caching for customer and purchase lookups
- low-overhead adapter wrappers (`http`, `next`, `mcp`)

## Guardrails

- optimize after measuring with reproducible benchmarks
- avoid caching data that can violate authorization boundaries
- keep cache invalidation explicit after purchase state changes
- prefer predictable behavior over micro-optimizations
- cite `budgets.json` for any size/cold-start statement

## What to validate

- browser WASM gzip size + cold start against `budgets.json` (`measure-wasm.mjs --check`)
- p95 latency impact for protected routes
- duplicate request collapse under concurrency
- cache hit/miss behavior for expected traffic patterns
- memory growth for long-lived processes

## Contributor checklist

- run `measure-wasm.mjs --check` when a change could affect WASM size/startup
- add benchmark or regression tests for performance-sensitive changes
- document invalidation rules alongside code changes
- verify no behavior regressions in `examples/` integrations

## Related docs

- [`architecture.md`](./architecture.md) — capability-separated builds
- [`testing.md`](./testing.md) — shadow harness (request-overhead deltas)
- [`rust-core-sdk-redesign-v2.md`](./rust-core-sdk-redesign-v2.md) §7.8 — budget rationale
