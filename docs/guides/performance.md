# Performance Optimization

This guide covers performance optimization strategies for SolvaPay SDK, including caching, request deduplication, and best practices.

## Table of Contents

- [Caching Strategies](#caching-strategies)
- [Request Deduplication](#request-deduplication)
- [Purchase Caching](#purchase-caching)
- [Best Practices](#best-practices)
- [Performance Monitoring](#performance-monitoring)

## Caching Strategies

### Customer Reference Caching

SolvaPay SDK automatically caches customer lookups to reduce API calls:

```typescript
import { createSolvaPay } from '@solvapay/server'

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })

// Customer lookups are automatically cached for 60 seconds
// Multiple concurrent requests share the same promise
const payable = solvaPay.payable({ agent: 'agt_myapi', plan: 'pln_premium' })
```

### Purchase Caching (Next.js)

Use purchase caching to reduce API calls:

```typescript
import { checkPurchase, clearPurchaseCache } from '@solvapay/next'

// Check purchase (cached automatically)
export async function GET(request: NextRequest) {
  const result = await checkPurchase(request)
  return NextResponse.json(result)
}

// Clear cache when purchase changes
export async function POST(request: NextRequest) {
  const userId = getUserIdFromRequest(request)
  await clearPurchaseCache(userId)
  // ... handle purchase update
}
```

### Cache Statistics

Monitor cache performance:

```typescript
import { getPurchaseCacheStats } from '@solvapay/next'

const stats = await getPurchaseCacheStats()
console.log('Cache hits:', stats.hits)
console.log('Cache misses:', stats.misses)
console.log('Cache size:', stats.size)
```

## Request Deduplication

SolvaPay SDK automatically deduplicates concurrent requests:

```typescript
// Multiple concurrent requests for the same customer
// share the same API call promise
const promises = [
  payable.http(createTask)(req1, res1),
  payable.http(createTask)(req2, res2),
  payable.http(createTask)(req3, res3),
]

// Only one API call is made, all requests share the result
await Promise.all(promises)
```

### How It Works

1. **Concurrent Requests**: Multiple requests for the same customer reference share the same promise
2. **Cache TTL**: Results are cached for 60 seconds to prevent duplicate sequential requests
3. **Automatic Cleanup**: Expired cache entries are automatically removed

## Purchase Caching

### Next.js Purchase Caching

The `@solvapay/next` package includes built-in purchase caching:

```typescript
// app/api/check-purchase/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { checkPurchase } from '@solvapay/next'

export async function GET(request: NextRequest) {
  // Automatically cached per user ID
  const result = await checkPurchase(request)
  return NextResponse.json(result)
}
```

### Cache Management

```typescript
import {
  clearPurchaseCache,
  clearAllPurchaseCache,
  getPurchaseCacheStats,
} from '@solvapay/next'

// Clear cache for specific user
await clearPurchaseCache(userId)

// Clear all caches
await clearAllPurchaseCache()

// Get cache statistics
const stats = await getPurchaseCacheStats()
```

### Cache Invalidation

Invalidate cache when purchase changes:

```typescript
// After successful payment
export async function POST(request: NextRequest) {
  const userId = getUserIdFromRequest(request)

  // Process payment...

  // Clear cache to force refresh
  await clearPurchaseCache(userId)

  return NextResponse.json({ success: true })
}
```

## Best Practices

### 1. Reuse SolvaPay Instances

Create a single SolvaPay instance and reuse it:

```typescript
// Good: Single instance
// lib/solvapay.ts
export const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })

// Bad: Creating new instances
const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY }) // In each file
```

### 2. Use Purchase Caching

Enable purchase caching in Next.js:

```typescript
// Good: Use cached purchase checks
import { checkPurchase } from '@solvapay/next'

export async function GET(request: NextRequest) {
  const result = await checkPurchase(request) // Cached automatically
  return NextResponse.json(result)
}
```

### 3. Batch Operations

Batch multiple operations when possible:

```typescript
// Good: Batch operations
const [purchase, customer] = await Promise.all([
  checkPurchase(request),
  getCustomer(request),
])

// Bad: Sequential operations
const purchase = await checkPurchase(request)
const customer = await getCustomer(request)
```

### 4. Minimize API Calls

Use caching and deduplication to minimize API calls:

```typescript
// SolvaPay automatically:
// - Deduplicates concurrent requests
// - Caches customer lookups (60s TTL)
// - Caches purchase checks (Next.js)
```

### 5. Edge Runtime Compatibility

Use Edge-compatible patterns:

```typescript
// Good: Edge-compatible
import { createSolvaPay } from '@solvapay/server'

export const runtime = 'edge'

export async function GET(request: Request) {
  const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })
  // Works in Edge runtime
}
```

## Performance Monitoring

### Measure API Call Latency

```typescript
import { createSolvaPay } from '@solvapay/server'

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })

async function measurePerformance() {
  const start = Date.now()

  await solvaPay.checkLimits({
    customerRef: 'user_123',
    agentRef: 'agt_myapi',
  })

  const latency = Date.now() - start
  console.log(`API call took ${latency}ms`)
}
```

### Monitor Cache Hit Rates

```typescript
import { getPurchaseCacheStats } from '@solvapay/next'

async function monitorCache() {
  const stats = await getPurchaseCacheStats()
  const hitRate = stats.hits / (stats.hits + stats.misses)

  console.log(`Cache hit rate: ${(hitRate * 100).toFixed(2)}%`)

  if (hitRate < 0.5) {
    console.warn('Low cache hit rate - consider increasing cache TTL')
  }
}
```

### Track Request Deduplication

```typescript
// SolvaPay automatically tracks and logs deduplication
// Enable debug mode to see deduplication in action:

const solvaPay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY,
  debug: true, // Enable debug logging
})
```

## Advanced Optimization

### Custom Cache Implementation

For advanced use cases, implement custom caching:

```typescript
import { createSolvaPay } from '@solvapay/server'
import { LRUCache } from 'lru-cache'

// Custom purchase cache
const purchaseCache = new LRUCache<string, any>({
  max: 1000,
  ttl: 60000, // 60 seconds
})

async function getCachedPurchase(userId: string, request: NextRequest) {
  const cached = purchaseCache.get(userId)
  if (cached) {
    return cached
  }

  // Fetch from API
  const purchase = await checkPurchase(request)
  purchaseCache.set(userId, purchase)

  return purchase
}
```

### Request Batching

Batch multiple customer lookups:

```typescript
async function batchCustomerLookups(userIds: string[]) {
  const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })

  // Batch lookups (SolvaPay handles deduplication)
  const promises = userIds.map(userId => solvaPay.ensureCustomer(userId, userId))

  const results = await Promise.all(promises)
  return results
}
```

## Performance Tips

1. **Enable Debug Mode Sparingly**: Debug logging adds overhead. Only enable in development.

2. **Monitor Cache Performance**: Track cache hit rates and adjust TTL values as needed.

3. **Use Edge Runtime**: Deploy to Edge runtime for lower latency.

4. **Minimize Payload Size**: Keep request/response payloads small.

5. **Use Compression**: Enable gzip compression for API responses.

6. **Monitor API Limits**: Track API usage to avoid rate limits.

## Next Steps

- [Testing with Stub Mode](./testing.md) - Test performance
- [Next.js Integration Guide](./nextjs.md) - Next.js performance tips
- [API Reference](../../packages/server/README.md) - Full API documentation
