# @solvapay/core

[![npm version](https://img.shields.io/npm/v/@solvapay/core.svg)](https://www.npmjs.com/package/@solvapay/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Shared types, schemas, errors, and utilities used across all SolvaPay SDK packages. Runtime-agnostic — no Node.js or browser globals.

**When to use this package:** rarely install directly. It is pulled in automatically by `@solvapay/server`, `@solvapay/react`, and other packages. Install only if you need shared types or `SolvaPayError` without a full SDK surface.

## Install

```bash
pnpm add @solvapay/core
```

## Key exports

```typescript
import { SolvaPayError, getSolvaPayConfig, Env } from '@solvapay/core'
import type { SolvaPayConfig } from '@solvapay/core'
```

- `SolvaPayError` — base error class for SDK errors
- `SolvaPayConfig` / `getSolvaPayConfig()` — config from `SOLVAPAY_SECRET_KEY` env
- `Env` — Zod schema for env validation
- `version` — current SDK version string

## See also

- [`@solvapay/server`](../server) — server-side paywall and API client
- [`@solvapay/react`](../react) — client-side checkout components
- [Architecture guide](../../docs/contributing/architecture.md) — package boundaries

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Docs**: [docs.solvapay.com/sdks/typescript](https://docs.solvapay.com/sdks/typescript/intro)
