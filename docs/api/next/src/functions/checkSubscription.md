[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / checkSubscription

# Function: checkSubscription()

> **checkSubscription**(`request`, `options`): `Promise`\<`NextResponse`\<`unknown`\> \| [`SubscriptionCheckResult`](../interfaces/SubscriptionCheckResult.md)\>

Defined in: [packages/next/src/index.ts:321](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/index.ts#L321)

Check user subscription status with automatic deduplication and caching.

This Next.js helper function provides optimized subscription checking with:
- Automatic request deduplication (concurrent requests share the same promise)
- Short-term caching (2 seconds) to prevent duplicate sequential requests
- Fast path optimization using cached customer references from client
- Automatic customer creation if needed

The function:
1. Extracts user ID from request (via requireUserId from @solvapay/auth)
2. Gets user email and name from Supabase JWT token (if available)
3. Validates cached customer reference (if provided via header)
4. Ensures customer exists in SolvaPay backend
5. Returns customer subscription information

## Parameters

### request

`Request`

Next.js request object (NextRequest extends Request)

### options

[`CheckSubscriptionOptions`](../interfaces/CheckSubscriptionOptions.md) = `{}`

Configuration options

## Returns

`Promise`\<`NextResponse`\<`unknown`\> \| [`SubscriptionCheckResult`](../interfaces/SubscriptionCheckResult.md)\>

Subscription check result with customer data and subscriptions, or NextResponse error

## Example

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  
  if (result instanceof NextResponse) {
    return result; // Error response
  }
  
  return NextResponse.json(result);
}
```

## See

 - [clearSubscriptionCache](clearSubscriptionCache.md) for cache management
 - [getSubscriptionCacheStats](getSubscriptionCacheStats.md) for cache monitoring

## Since

1.0.0
