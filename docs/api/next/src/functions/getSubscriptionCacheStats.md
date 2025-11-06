[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / getSubscriptionCacheStats

# Function: getSubscriptionCacheStats()

> **getSubscriptionCacheStats**(): `object`

Defined in: [packages/next/src/index.ts:545](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L545)

Get subscription cache statistics for monitoring and debugging.

Returns the current state of the subscription cache, including:
- Number of in-flight requests (being deduplicated)
- Number of cached results

## Returns

`object`

Cache statistics object

### cached

> **cached**: `number`

### inFlight

> **inFlight**: `number`

## Example

```typescript
import { getSubscriptionCacheStats } from '@solvapay/next';

// In a monitoring endpoint
export async function GET() {
  const stats = getSubscriptionCacheStats();
  return Response.json({
    cache: {
      inFlight: stats.inFlight,
      cached: stats.cached
    }
  });
}
```

## See

[checkSubscription](checkSubscription.md) for subscription checking

## Since

1.0.0
