# @solvapay/next

Next.js-specific utilities and helpers for SolvaPay SDK.

This package provides framework-specific helpers for Next.js API routes with built-in optimizations like request deduplication and caching.

## Installation

```bash
npm install @solvapay/next @solvapay/server next
```

## Usage

### Check Subscription

The `checkSubscription` helper provides a simple way to check user subscription status in Next.js API routes with built-in request deduplication:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  
  // If result is a NextResponse, it's an error response - return it
  if (result instanceof NextResponse) {
    return result;
  }
  
  // Otherwise, return the subscription data
  return NextResponse.json(result);
}
```

### Features

- **Automatic Deduplication**: Prevents duplicate API calls by deduplicating concurrent requests
- **Caching**: Caches results for 2 seconds to prevent duplicate sequential requests
- **Automatic Cleanup**: Expired cache entries are automatically cleaned up
- **Memory Safe**: Maximum cache size limits prevent memory issues

### Cache Management

```typescript
import { 
  clearSubscriptionCache, 
  clearAllSubscriptionCache,
  getSubscriptionCacheStats 
} from '@solvapay/next';

// Clear cache for a specific user
clearSubscriptionCache(userId);

// Clear all cache entries
clearAllSubscriptionCache();

// Get cache statistics
const stats = getSubscriptionCacheStats();
console.log(`In-flight: ${stats.inFlight}, Cached: ${stats.cached}`);
```

## Requirements

- Next.js >= 13.0.0
- Node.js >= 18.17

## Why a Separate Package?

This package is separate from `@solvapay/server` to keep the server package framework-agnostic. Users who use Express, Fastify, or other frameworks don't need Next.js as a dependency.

