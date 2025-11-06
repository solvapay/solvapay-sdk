[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / createAuthMiddleware

# Function: createAuthMiddleware()

> **createAuthMiddleware**(`options`): (`request`) => `Promise`\<`NextResponse`\<`unknown`\>\>

Defined in: [packages/next/src/helpers/middleware.ts:112](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/middleware.ts#L112)

Creates a Next.js middleware function for authentication

This helper:
1. Uses the provided AuthAdapter to extract userId from requests
2. Handles public vs protected routes
3. Adds userId to request headers for downstream routes
4. Returns appropriate error responses for auth failures

## Parameters

### options

[`AuthMiddlewareOptions`](../interfaces/AuthMiddlewareOptions.md)

Configuration options

## Returns

Next.js middleware function (can be exported as `middleware` or `proxy`)

> (`request`): `Promise`\<`NextResponse`\<`unknown`\>\>

### Parameters

#### request

`NextRequest`

### Returns

`Promise`\<`NextResponse`\<`unknown`\>\>

## Examples

```typescript
// middleware.ts (at project root)
import { createAuthMiddleware } from '@solvapay/next';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

const adapter = new SupabaseAuthAdapter({
  jwtSecret: process.env.SUPABASE_JWT_SECRET!,
});

export const middleware = createAuthMiddleware({
  adapter,
  publicRoutes: ['/api/list-plans'],
});

export const config = {
  matcher: ['/api/:path*'],
};
```

```typescript
// src/proxy.ts (in src/ folder, not project root)
import { createAuthMiddleware } from '@solvapay/next';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

const adapter = new SupabaseAuthAdapter({
  jwtSecret: process.env.SUPABASE_JWT_SECRET!,
});

// Use 'proxy' export for Next.js 16 (no deprecation warning)
export const proxy = createAuthMiddleware({
  adapter,
  publicRoutes: ['/api/list-plans'],
});

export const config = {
  matcher: ['/api/:path*'],
};
```

```typescript
import { createAuthMiddleware } from '@solvapay/next';
import type { AuthAdapter } from '@solvapay/auth';

const myAdapter: AuthAdapter = {
  async getUserIdFromRequest(req) {
    // Your custom auth logic
    return userId;
  },
};

export const middleware = createAuthMiddleware({
  adapter: myAdapter,
});
```

**File Location Notes:**
- **Next.js 15**: Place `middleware.ts` at project root
- **Next.js 16 without `src/` folder**: Place `middleware.ts` or `proxy.ts` at project root
- **Next.js 16 with `src/` folder**: Place `src/proxy.ts` or `src/middleware.ts` (in `src/` folder, not root)

**Note:** Next.js 16 renamed "middleware" to "proxy". You can export the return value as either
`middleware` or `proxy` - both work, but `proxy` is recommended to avoid deprecation warnings.
