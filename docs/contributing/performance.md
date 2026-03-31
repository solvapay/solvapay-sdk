# SDK performance (contributors)

This page is for maintainers optimizing SDK internals and framework adapters.

## Focus areas

- request deduplication for repeated purchase checks
- short-lived caching for customer and purchase lookups
- low-overhead adapter wrappers (`http`, `next`, `mcp`)
- minimal serialization work on hot paths

## Guardrails

- optimize after measuring with reproducible benchmarks
- avoid caching data that can violate authorization boundaries
- keep cache invalidation explicit after purchase state changes
- prioritize predictable behavior over micro-optimizations

## What to validate

- p95 latency impact for protected routes
- duplicate request collapse under concurrency
- cache hit/miss behavior for expected traffic patterns
- memory growth for long-lived processes

## Contributor checklist

- add benchmark or regression tests for performance-sensitive changes
- document invalidation rules with code changes
- verify no behavior regressions in `examples/` integrations

## Related docs

- `docs/contributing/architecture.md`
- `docs/contributing/testing.md`
