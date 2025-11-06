[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / clearSubscriptionCache

# Function: clearSubscriptionCache()

> **clearSubscriptionCache**(`userId`): `void`

Defined in: [packages/next/src/index.ts:484](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L484)

Clear subscription cache for a specific user.

Useful when you know subscription status has changed (e.g., after a successful
checkout, subscription update, or cancellation). This forces the next
`checkSubscription()` call to fetch fresh data from the backend.

## Parameters

### userId

`string`

User ID to clear cache for

## Returns

`void`

## Example

```typescript
import { clearSubscriptionCache } from '@solvapay/next';

// After successful payment
await processPayment(request, body);
clearSubscriptionCache(userId); // Force refresh on next check
```

## See

 - [checkSubscription](checkSubscription.md) for subscription checking
 - [clearAllSubscriptionCache](clearAllSubscriptionCache.md) to clear all cache entries

## Since

1.0.0
