# @solvapay/core

Shared types, schemas, errors, and utilities used across all SolvaPay SDK packages.

This package is **runtime-agnostic** -- it contains no Node.js or browser globals and has `"sideEffects": false`.

## Install

```bash
npm install @solvapay/core
# or
yarn add @solvapay/core
# or
pnpm add @solvapay/core
```

## Exports

### `SolvaPayError`

Base error class for all SolvaPay SDK errors. Useful for catching SDK-specific errors:

```typescript
import { SolvaPayError } from '@solvapay/core'

try {
  const config = getSolvaPayConfig()
} catch (error) {
  if (error instanceof SolvaPayError) {
    console.error('SolvaPay error:', error.message)
  }
}
```

### `SolvaPayConfig`

Configuration interface for the SDK:

```typescript
import type { SolvaPayConfig } from '@solvapay/core'

const config: SolvaPayConfig = {
  apiKey: 'sk_live_...',
  apiBaseUrl: 'https://api.solvapay.com', // optional
}
```

### `getSolvaPayConfig()`

Validates and returns configuration from environment variables. Reads `SOLVAPAY_SECRET_KEY` and optional `SOLVAPAY_API_BASE_URL`:

```typescript
import { getSolvaPayConfig } from '@solvapay/core'

const config = getSolvaPayConfig()
// config.apiKey - from SOLVAPAY_SECRET_KEY
// config.apiBaseUrl - from SOLVAPAY_API_BASE_URL (optional)
```

Throws `SolvaPayError` if `SOLVAPAY_SECRET_KEY` is not set.

### `Env`

Zod schema for validating environment variables:

```typescript
import { Env } from '@solvapay/core'

const result = Env.safeParse(process.env)
if (!result.success) {
  console.error('Invalid environment:', result.error)
}
```

### `version`

The current SDK version string.

## When to Use This Package

Most developers don't need to install `@solvapay/core` directly -- it's automatically included as a dependency of `@solvapay/server`, `@solvapay/react`, and other packages. Install it directly only if you need access to the shared types or error classes without pulling in a full SDK package.

## More Information

- [Architecture Guide](../../docs/guides/architecture.md) - Package design and boundaries
- [Server SDK](../server/README.md) - Server-side paywall protection
- [React SDK](../react/README.md) - Client-side payment components
