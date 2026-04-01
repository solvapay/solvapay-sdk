# SDK error handling (contributors)

This page is for maintainers working on SDK internals and adapters.

## Error taxonomy

- `SolvaPayError`: base SDK error type
- `PaywallError`: payment required or limit exceeded, includes structured payload
- native errors: framework/runtime/network failures from host code

## Design goals

- keep structured payloads stable for adapters
- return actionable details without leaking secrets
- preserve root-cause context in logs while keeping external messages concise

## Adapter behavior

- `http` adapters should map paywall errors to HTTP `402`
- `next` adapters should return consistent `NextResponse` error payloads
- `mcp` adapters should preserve structured content for tool clients

## Contributor checklist

- validate error shape changes across `@solvapay/server`, `@solvapay/next`, and examples
- add unit tests for new branches and edge cases
- update integration examples if response shape or status handling changes
- keep user-facing copy short and deterministic

## Related docs

- `docs/contributing/testing.md`
- `CONTRIBUTING.md`
