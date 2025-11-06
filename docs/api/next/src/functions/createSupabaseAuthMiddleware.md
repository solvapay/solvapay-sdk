[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / createSupabaseAuthMiddleware

# Function: createSupabaseAuthMiddleware()

> **createSupabaseAuthMiddleware**(`options`): (`request`) => `Promise`\<`NextResponse`\<`unknown`\>\>

Defined in: [packages/next/src/helpers/middleware.ts:236](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/middleware.ts#L236)

Creates a Next.js middleware function for Supabase authentication

Convenience function that creates a SupabaseAuthAdapter and wraps it with createAuthMiddleware.
Only use this if you're using Supabase - otherwise use createAuthMiddleware with your own adapter.

Uses dynamic import to avoid requiring Supabase as a dependency in @solvapay/next.

## Parameters

### options

[`SupabaseAuthMiddlewareOptions`](../interfaces/SupabaseAuthMiddlewareOptions.md) = `{}`

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
import { createSupabaseAuthMiddleware } from '@solvapay/next';

export const middleware = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans'],
});

export const config = {
  matcher: ['/api/:path*'],
};
```

```typescript
// src/proxy.ts (in src/ folder, not project root)
import { createSupabaseAuthMiddleware } from '@solvapay/next';

// Use 'proxy' export for Next.js 16 (no deprecation warning)
export const proxy = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans'],
});

export const config = {
  matcher: ['/api/:path*'],
};
```

**File Location Notes:**
- **Next.js 15**: Place `middleware.ts` at project root
- **Next.js 16 without `src/` folder**: Place `middleware.ts` or `proxy.ts` at project root
- **Next.js 16 with `src/` folder**: Place `src/proxy.ts` or `src/middleware.ts` (in `src/` folder, not root)

**Note:** Next.js 16 renamed "middleware" to "proxy". You can export the return value as either
`middleware` or `proxy` - both work, but `proxy` is recommended to avoid deprecation warnings.
