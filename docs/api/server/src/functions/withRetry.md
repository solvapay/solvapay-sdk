[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / withRetry

# Function: withRetry()

> **withRetry**\<`T`\>(`fn`, `options`): `Promise`\<`T`\>

Defined in: [packages/server/src/utils.ts:44](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/utils.ts#L44)

Execute an async function with automatic retry logic.

This utility function provides configurable retry logic with exponential backoff,
conditional retry logic, and retry callbacks. Useful for handling transient
network errors or rate limiting.

## Type Parameters

### T

`T`

The return type of the async function

## Parameters

### fn

() => `Promise`\<`T`\>

The async function to execute

### options

[`RetryOptions`](../interfaces/RetryOptions.md) = `{}`

Retry configuration options

## Returns

`Promise`\<`T`\>

A promise that resolves with the function result or rejects with the last error

## Example

```typescript
// Simple retry with defaults (2 retries, 500ms delay)
const result = await withRetry(() => apiCall());

// Custom retry with exponential backoff
const result = await withRetry(
  () => apiCall(),
  {
    maxRetries: 3,
    initialDelay: 1000,
    backoffStrategy: 'exponential',
    shouldRetry: (error) => error.message.includes('timeout'),
    onRetry: (error, attempt) => console.log(`Retry ${attempt + 1}`)
  }
);
```

## Since

1.0.0
