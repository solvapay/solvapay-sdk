# Generated Types Directory

This directory contains auto-generated TypeScript types from the SolvaPay backend OpenAPI specification.

## Generating Types

The backend is a set of independent NestJS services (post monolith split), each
serving its own `/v1/openapi.json`. The generator fetches every service that
owns `/v1/sdk/*` routes, merges their SDK slice into one document, sorts it
deterministically, and emits `generated.ts`.

To generate types from your locally running backend:

1. Start the backend services locally. By default the generator reads:
   - `http://localhost:3002/v1/openapi.json` (provider-service)
   - `http://localhost:3003/v1/openapi.json` (payment-service)
   - `http://localhost:3004/v1/openapi.json` (billing-service)
   - `http://localhost:3005/v1/openapi.json` (commerce-service)
   - `http://localhost:3008/v1/openapi.json` (webhook-service)
2. Run the generation script:

```bash
# From the root of the monorepo
pnpm --filter @solvapay/server generate:types

# Or from packages/server directory
pnpm generate:types
```

**Note:** Only routes starting with `/v1/sdk/` are included in the generated types.

### Overriding the source

If you have a single aggregated OpenAPI document (e.g. an API gateway, or the
committed `docs/api-reference/openapi.json` served over HTTP), point the
generator at it instead:

```bash
# Single aggregated source
BACKEND_OPENAPI_URL="http://localhost:8080/v1/openapi.json" pnpm generate:types

# Or an explicit list of per-service sources (comma or space separated)
BACKEND_OPENAPI_URLS="http://localhost:3002/v1/openapi.json,http://localhost:3003/v1/openapi.json" pnpm generate:types
```

This mirrors `docs/scripts/sync-backend-openapi.ts`, which uses the same
`BACKEND_OPENAPI_URL` / `BACKEND_OPENAPI_URLS` environment variables.

## Files

- `generated.ts` - Auto-generated TypeScript types from OpenAPI spec
- `README.md` - This file

## Usage

Import the generated types in your code:

```typescript
import type { paths, components } from './types/generated'

// Use path operation types
type CheckLimitsRequest =
  paths['/v1/sdk/limits']['post']['requestBody']['content']['application/json']
type CheckLimitsResponse =
  paths['/v1/sdk/limits']['post']['responses']['200']['content']['application/json']

// Use component schemas
type Agent = components['schemas']['Agent']
```

## Important Notes

- These types are generated from the OpenAPI specification and should not be manually edited
- Only routes starting with `/v1/sdk/` are included (the generator filters and merges each service's SDK slice)
- Only schemas reachable from the SDK routes are kept; unreferenced schemas are pruned
- Output is deterministically sorted and Prettier-formatted, so re-running produces a stable diff
- Run the generation script whenever the backend API changes
- The generated file is committed to the repository for convenience
- If a source service is not running, the script will fail

## Type Mappings

The `types.ts` file provides mapped types that bridge differences between the generated OpenAPI types and the SDK's interface:

- `LimitResponseWithPlan` - Extends `LimitResponse` with a required `plan` field
- `CustomerResponseMapped` - Maps backend's `reference` field to `customerRef` for consistency
