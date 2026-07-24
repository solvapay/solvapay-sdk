# Generated types (`@solvapay/server`)

This directory holds OpenAPI-derived and dto-gen-derived TypeScript artifacts.

For the full five-surface SDK codegen runbook (manifest, bindings, CI gates), see
[`docs/contributing/sdk-codegen.md`](../../../../docs/contributing/sdk-codegen.md).

## Files

| File                                                  | Producer                                                                            | Edit? |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | ----- |
| `generated.ts`                                        | `pnpm --filter @solvapay/server generate:types` (live OpenAPI → openapi-typescript) | No    |
| `overlays.generated.d.ts`                             | `pnpm gen` (dto-gen)                                                                | No    |
| `client.generated.d.ts`                               | `pnpm gen` (dto-gen)                                                                | No    |
| `../native.ts` / `../wasm.ts`                         | `pnpm gen` (dto-gen)                                                                | No    |
| `../__generated__/signature-parity.generated.test.ts` | `pnpm gen` (dto-gen)                                                                | No    |

Only `/v1/sdk/*` paths are included (agents routes excluded). See
`scripts/lib/openapi-pipeline.ts`.

## Typical flows

### Refresh wire types from a local backend

```bash
# Backend must serve http://localhost:3001/v1/openapi.json
pnpm --filter @solvapay/server generate:types   # → generated.ts
pnpm snapshot:openapi --from-url                # → contract/openapi/*
pnpm gen                                        # → overlays, client, native, all surfaces
```

### Regenerate facades after a manifest-only change

```bash
pnpm gen
pnpm gen:check   # must be clean before push / CI
```

## Usage

```typescript
import type { components, paths } from './generated'

type CheckLimitsRequest =
  paths['/v1/sdk/limits']['post']['requestBody']['content']['application/json']
```

Hand-written bridges that adapt wire shapes to SDK ergonomics live in nearby
non-generated modules (e.g. mapped customer/plan helpers). Prefer extending the
manifest `overlays:` catalog + `pnpm gen` when the shape should be
cross-language.
