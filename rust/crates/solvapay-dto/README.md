# solvapay-dto

Generated SolvaPay wire DTOs. **Do not hand-edit.**

## Regenerate

From the monorepo root:

```bash
pnpm gen
```

That runs `dto-gen` with the canonical flag set in [`scripts/gen.ts`](../../../scripts/gen.ts)
(OpenAPI snapshot + contract manifest → this crate plus all language surfaces).

Drift gate: `pnpm gen:check` (also used in CI).

Full contributor runbook: [`docs/contributing/sdk-codegen.md`](../../../docs/contributing/sdk-codegen.md).

## Consumers

This crate is published so the public [`solvapay`](https://crates.io/crates/solvapay)
facade can depend on it by version. Prefer the facade for application code.
