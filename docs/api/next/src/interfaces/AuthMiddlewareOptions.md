[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / AuthMiddlewareOptions

# Interface: AuthMiddlewareOptions

Defined in: [packages/next/src/helpers/middleware.ts:15](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/middleware.ts#L15)

Configuration options for authentication middleware

## Properties

### adapter

> **adapter**: `AuthAdapter`

Defined in: [packages/next/src/helpers/middleware.ts:20](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/middleware.ts#L20)

Auth adapter instance to use for extracting user IDs from requests
You can use SupabaseAuthAdapter, MockAuthAdapter, or create your own

***

### publicRoutes?

> `optional` **publicRoutes**: `string`[]

Defined in: [packages/next/src/helpers/middleware.ts:26](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/middleware.ts#L26)

Public routes that don't require authentication
Routes are matched using pathname.startsWith()

***

### userIdHeader?

> `optional` **userIdHeader**: `string`

Defined in: [packages/next/src/helpers/middleware.ts:31](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/middleware.ts#L31)

Header name to store the user ID (default: 'x-user-id')
