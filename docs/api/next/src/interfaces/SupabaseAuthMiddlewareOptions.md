[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / SupabaseAuthMiddlewareOptions

# Interface: SupabaseAuthMiddlewareOptions

Defined in: [packages/next/src/helpers/middleware.ts:169](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/middleware.ts#L169)

Configuration options for Supabase authentication middleware

## Properties

### jwtSecret?

> `optional` **jwtSecret**: `string`

Defined in: [packages/next/src/helpers/middleware.ts:174](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/middleware.ts#L174)

Supabase JWT secret (from Supabase dashboard: Settings → API → JWT Secret)
If not provided, will use SUPABASE_JWT_SECRET environment variable

***

### publicRoutes?

> `optional` **publicRoutes**: `string`[]

Defined in: [packages/next/src/helpers/middleware.ts:180](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/middleware.ts#L180)

Public routes that don't require authentication
Routes are matched using pathname.startsWith()

***

### userIdHeader?

> `optional` **userIdHeader**: `string`

Defined in: [packages/next/src/helpers/middleware.ts:185](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/middleware.ts#L185)

Header name to store the user ID (default: 'x-user-id')
