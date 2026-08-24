# @solvapay/auth

[![npm version](https://img.shields.io/npm/v/@solvapay/auth.svg)](https://www.npmjs.com/package/@solvapay/auth)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Authentication adapters for extracting user IDs from requests — Supabase JWT, mock/testing, and Next.js route utilities.

**When to use this package:** wire customer identity into `@solvapay/server` paywalls or Next.js API routes. Always fail closed on missing auth.

## Install

```bash
pnpm add @solvapay/auth
```

If using `SupabaseAuthAdapter`, also install `jose`:

```bash
pnpm add jose
```

Guide: [Custom auth](https://docs.solvapay.com/sdks/typescript/guides/custom-auth)

## Quickstart — Supabase

```typescript
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase'
import { createSolvaPay } from '@solvapay/server'

const auth = new SupabaseAuthAdapter({ jwtSecret: process.env.SUPABASE_JWT_SECRET! })
const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY! })

export const POST = solvaPay.payable({ product: 'my-api' }).next(
  async args => ({ result: 'success' }),
  {
    getCustomerRef: async req => {
      const userId = await auth.getUserIdFromRequest(req)
      if (!userId) throw new Error('Unauthorized')
      return userId
    },
  },
)
```

## Mock adapter (tests)

```typescript
import { MockAuthAdapter } from '@solvapay/auth/mock'

const auth = new MockAuthAdapter()
// Set header: x-mock-user-id: user_123
// Or env: MOCK_USER_ID=user_123
```

## Next.js route utilities

```typescript
import { requireUserId, getUserIdFromRequest } from '@solvapay/auth'

export async function GET(request: Request) {
  const userIdOrError = requireUserId(request)
  if (userIdOrError instanceof Response) return userIdOrError
  // userIdOrError is the authenticated user ID
}
```

`getUserEmailFromRequest` and `getUserNameFromRequest` decode Supabase JWT claims when `SUPABASE_JWT_SECRET` is set.

## See also

- [`@solvapay/server`](../server) — paywall adapters with `getCustomerRef`
- [`@solvapay/next`](../next) — Next.js helpers + `createSupabaseAuthMiddleware` / `createAuth0AuthMiddleware`
- [`@solvapay/react-supabase`](../react-supabase) — client-side Supabase adapter

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Docs**: [docs.solvapay.com/sdks/typescript/guides/custom-auth](https://docs.solvapay.com/sdks/typescript/guides/custom-auth)
