# Generated types (`@solvapay/server`)

This directory holds OpenAPI-derived and dto-gen-derived TypeScript artifacts.

For the full five-surface SDK codegen runbook (manifest, bindings, CI gates), see
[`docs/contributing/sdk-codegen.md`](../../../../docs/contributing/sdk-codegen.md).


**Note:** Only routes starting with `/v1/sdk/` are included in the generated types.

Wire types come from the committed OpenAPI snapshot
(`contract/openapi/sdk-v1.snapshot.json`) via `pnpm gen`. Do not fetch
`localhost:3001` — that serves the identity spec only and would strip plan
and product schemas.

## Files

| File                                                  | Producer                                                                            | Edit? |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | ----- |
| `generated.ts`                                        | `pnpm gen` (openapi-typescript from committed snapshot)                             | No    |
| `overlays.generated.d.ts`                             | `pnpm gen` (dto-gen)                                                                | No    |
| `client.generated.d.ts`                               | `pnpm gen` (dto-gen)                                                                | No    |
| `../native.ts` / `../wasm.ts`                         | `pnpm gen` (dto-gen)                                                                | No    |
| `../__generated__/signature-parity.generated.test.ts` | `pnpm gen` (dto-gen)                                                                | No    |

Only `/v1/sdk/*` paths are included (agents routes excluded). See
`tools/codegen/lib/openapi-pipeline.ts`.

## Relationship to dto-gen

`generated.ts` is the OpenAPI-derived substrate, not a parallel leftover next to
dto-gen. The dto-gen artifacts in this directory (`overlays.generated.d.ts`,
`client.generated.d.ts`) import from it:

```typescript
import type { components, operations } from './generated'
```

The two pipelines are layered: `pnpm snapshot:openapi --from-stack` records
the wire contract; `pnpm gen` emits `generated.ts` from that snapshot and the
dto-gen facades against it. `generated.ts` is also re-exported from
`types/index.ts` (`paths`, `components`, `operations`) and is the independent
reference `src/types/__tests__/api-diff.test-d.ts` uses to validate dto-gen's
`client.generated.d.ts`.

## Typical flows

### Refresh wire types from a local backend

```bash
# Five local services must serve /v1/openapi.json (see local-stack.yaml)
pnpm snapshot:openapi --from-stack            # → contract/openapi/*
pnpm gen                                      # → generated.ts, overlays, clients, all surfaces
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

