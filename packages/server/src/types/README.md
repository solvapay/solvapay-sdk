# Generated Types Directory

This directory contains auto-generated TypeScript types from the SolvaPay backend OpenAPI specification.

## Generating Types

To generate types from your locally running backend:

1. Start your backend server locally (default port: 3001)
2. Ensure the OpenAPI spec is available at `http://localhost:3001/v1/openapi.json`
3. Run the generation script:

**Note:** Only routes starting with `/v1/sdk/` are included in the generated types.

```bash
# From the root of the monorepo
pnpm --filter @solvapay/server generate:types

# Or from packages/server directory
pnpm generate:types
```

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
- Only routes starting with `/v1/sdk/` are included (filtered using `--path-filter "^/v1/sdk/"`)
- After generation, you may need to manually remove duplicate operations if the backend has overlapping route definitions
- Run the generation script whenever the backend API changes
- The generated file is committed to the repository for convenience
- If the backend is not running, the script will fail

## Type Mappings

The `types.ts` file provides mapped types that bridge differences between the generated OpenAPI types and the SDK's interface:

- `LimitResponseWithPlan` - Extends `LimitResponse` with a required `plan` field
- `CustomerResponseMapped` - Maps backend's `reference` field to `customerRef` for consistency
