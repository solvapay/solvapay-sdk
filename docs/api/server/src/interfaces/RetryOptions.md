[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / RetryOptions

# Interface: RetryOptions

Defined in: [packages/server/src/types/options.ts:11](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L11)

Retry configuration options

## Properties

### backoffStrategy?

> `optional` **backoffStrategy**: `"fixed"` \| `"linear"` \| `"exponential"`

Defined in: [packages/server/src/types/options.ts:28](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L28)

Backoff strategy for calculating delay between retries (default: 'fixed')
- 'fixed': Same delay between all retries
- 'linear': Delay increases linearly (initialDelay * attempt)
- 'exponential': Delay doubles each attempt (initialDelay * 2^(attempt-1))

***

### initialDelay?

> `optional` **initialDelay**: `number`

Defined in: [packages/server/src/types/options.ts:20](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L20)

Initial delay between retries in milliseconds (default: 500)

***

### maxRetries?

> `optional` **maxRetries**: `number`

Defined in: [packages/server/src/types/options.ts:15](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L15)

Maximum number of retry attempts (default: 2)

***

### onRetry()?

> `optional` **onRetry**: (`error`, `attempt`) => `void`

Defined in: [packages/server/src/types/options.ts:43](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L43)

Optional callback invoked before each retry attempt

#### Parameters

##### error

`Error`

The error that triggered the retry

##### attempt

`number`

The current attempt number (0-indexed)

#### Returns

`void`

***

### shouldRetry()?

> `optional` **shouldRetry**: (`error`, `attempt`) => `boolean`

Defined in: [packages/server/src/types/options.ts:36](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/options.ts#L36)

Optional function to determine if a retry should be attempted based on the error

#### Parameters

##### error

`Error`

The error that was thrown

##### attempt

`number`

The current attempt number (0-indexed)

#### Returns

`boolean`

true if a retry should be attempted, false otherwise
