# SolvaPay Examples - Shared Utilities

This folder contains shared utilities used across multiple examples in the SolvaPay SDK.

## Contents

### `stub-api-client.ts`

A demo implementation of the SolvaPay API client that simulates backend behavior for local development and testing.

**Features:**
- ✅ Free tier tracking with configurable daily limits
- ✅ Customer management (create, retrieve)
- ✅ In-memory or file-based persistence
- ✅ Simulates realistic API delays
- ✅ Debug logging

**Usage:**

```typescript
import { createStubClient } from '../shared/stub-api-client';

// Simple in-memory client (default)
const apiClient = createStubClient();

// With file persistence (survives server restarts)
const apiClient = createStubClient({ 
  useFileStorage: true 
});

// With custom configuration
const apiClient = createStubClient({
  useFileStorage: true,
  freeTierLimit: 10,  // 10 free calls per day
  debug: true,        // Enable logging
  delays: {
    checkLimits: 100, // Simulate 100ms API delay
    trackUsage: 50,
    customer: 50
  }
});
```

**Why use this?**

1. **No backend required** - Start developing immediately without setting up infrastructure
2. **Realistic behavior** - Simulates rate limits, delays, and persistence
3. **Easy testing** - Helper methods for manipulating test data
4. **Consistent** - Same interface as production `createSolvaPayClient()`

**When to use production client:**

```typescript
import { createSolvaPayClient } from '@solvapay/server';

const apiClient = createSolvaPayClient({
  apiKey: process.env.SOLVAPAY_SECRET_KEY!,
  apiBaseUrl: 'https://api.solvapay.com'
});
```

## Examples Using This

- **express-basic** - Express.js API with paywall protection
- **mcp-basic** - Model Context Protocol server with paywalls
- More examples coming soon...

## Implementation Notes

The stub client implements the `SolvaPayClient` interface from `@solvapay/server`:

```typescript
interface SolvaPayClient {
  checkLimits(params: {...}): Promise<{...}>;
  trackUsage(params: {...}): Promise<void>;
  createCustomer?(params: {...}): Promise<{...}>;
  getCustomer?(params: {...}): Promise<{...}>;
}
```

This ensures drop-in compatibility with the production client - just swap the import and you're ready for production!

## Helper Methods

The stub client includes additional helper methods for testing:

```typescript
// Add credits to a customer
await apiClient.addCredits('customer_123', 100);

// Get customer credits
const credits = await apiClient.getCredits('customer_123');

// Reset usage counters
await apiClient.resetUsage('customer_123'); // Reset specific customer
await apiClient.resetUsage(); // Reset all
```

## File Storage

When `useFileStorage: true` is enabled, data is persisted to `.demo-data/` directory:

```
.demo-data/
  customers.json       - Customer data and credits
  free-tier-usage.json - Daily usage counters
```

Add `.demo-data/` to your `.gitignore` to avoid committing test data.

## License

MIT - Part of the SolvaPay SDK

