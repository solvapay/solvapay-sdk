[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / clearAllSubscriptionCache

# Function: clearAllSubscriptionCache()

> **clearAllSubscriptionCache**(): `void`

Defined in: [packages/next/src/index.ts:510](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L510)

Clear all subscription cache entries.

Useful for testing, debugging, or when you need to force fresh lookups
for all users. This clears both the in-flight request cache and the
result cache.

## Returns

`void`

## Example

```typescript
import { clearAllSubscriptionCache } from '@solvapay/next';

// In a test setup
beforeEach(() => {
  clearAllSubscriptionCache();
});
```

## See

 - [clearSubscriptionCache](clearSubscriptionCache.md) to clear cache for a specific user
 - [getSubscriptionCacheStats](getSubscriptionCacheStats.md) for cache monitoring

## Since

1.0.0
