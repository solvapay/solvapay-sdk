[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / SolvaPayConfig

# Interface: SolvaPayConfig

Defined in: [packages/react/src/types/index.ts:66](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L66)

SolvaPay Provider Configuration
Sensible defaults for minimal code, but fully customizable

## Properties

### api?

> `optional` **api**: `object`

Defined in: [packages/react/src/types/index.ts:71](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L71)

API route configuration
Defaults to standard Next.js API routes

#### checkSubscription?

> `optional` **checkSubscription**: `string`

#### createPayment?

> `optional` **createPayment**: `string`

#### processPayment?

> `optional` **processPayment**: `string`

***

### auth?

> `optional` **auth**: `object`

Defined in: [packages/react/src/types/index.ts:81](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L81)

Authentication configuration
Uses adapter pattern for flexible auth provider support

#### adapter?

> `optional` **adapter**: [`AuthAdapter`](AuthAdapter.md)

Auth adapter instance
Default: checks localStorage for 'auth_token' key

##### Example

```tsx
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';

<SolvaPayProvider
  config={{
    auth: {
      adapter: createSupabaseAuthAdapter({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      })
    }
  }}
>
```

#### ~~getToken()?~~

> `optional` **getToken**: () => `Promise`\<`string` \| `null`\>

##### Returns

`Promise`\<`string` \| `null`\>

##### Deprecated

Use `adapter` instead. Will be removed in a future version.
Function to get auth token

#### ~~getUserId()?~~

> `optional` **getUserId**: () => `Promise`\<`string` \| `null`\>

##### Returns

`Promise`\<`string` \| `null`\>

##### Deprecated

Use `adapter` instead. Will be removed in a future version.
Function to get user ID (for cache key)

***

### fetch()?

> `optional` **fetch**: \{(`input`, `init?`): `Promise`\<`Response`\>; (`input`, `init?`): `Promise`\<`Response`\>; \}

Defined in: [packages/react/src/types/index.ts:121](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L121)

Custom fetch implementation
Default: uses global fetch

#### Call Signature

> (`input`, `init?`): `Promise`\<`Response`\>

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

##### Parameters

###### input

`URL` | `RequestInfo`

###### init?

`RequestInit`

##### Returns

`Promise`\<`Response`\>

#### Call Signature

> (`input`, `init?`): `Promise`\<`Response`\>

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

##### Parameters

###### input

`string` | `Request` | `URL`

###### init?

`RequestInit`

##### Returns

`Promise`\<`Response`\>

***

### headers?

> `optional` **headers**: `HeadersInit` \| () => `Promise`\<`HeadersInit`\>

Defined in: [packages/react/src/types/index.ts:127](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L127)

Request headers to include in all API calls
Default: empty

***

### onError()?

> `optional` **onError**: (`error`, `context`) => `void`

Defined in: [packages/react/src/types/index.ts:133](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L133)

Custom error handler
Default: logs to console

#### Parameters

##### error

`Error`

##### context

`string`

#### Returns

`void`
