# Testing with Stub Mode

This guide shows you how to test SolvaPay SDK using stub mode, which simulates the SolvaPay backend without making real API calls.

## Table of Contents

- [What is Stub Mode?](#what-is-stub-mode)
- [Using Stub Mode](#using-stub-mode)
- [Stub Client Configuration](#stub-client-configuration)
- [Testing Strategies](#testing-strategies)
- [Complete Examples](#complete-examples)

## What is Stub Mode?

Stub mode is a testing mode that simulates the SolvaPay backend API without making real HTTP requests. It's perfect for:

- **Local Development** - Test without API keys
- **Unit Testing** - Fast, isolated tests
- **Integration Testing** - Test full flows without external dependencies
- **CI/CD Pipelines** - Run tests without API credentials

### Features

- Free tier tracking with configurable limits
- Customer management simulation
- In-memory or file-based persistence
- Realistic API delay simulation
- No external dependencies

## Using Stub Mode

### Automatic Stub Mode

SolvaPay automatically uses stub mode when no API key is provided:

```typescript
import { createSolvaPay } from '@solvapay/server'

// Automatically uses stub mode (no API key)
const solvaPay = createSolvaPay()
```

### Explicit Stub Client

For more control, use a stub client:

```typescript
import { createSolvaPay } from '@solvapay/server'
import { createStubClient } from './stub-api-client' // From examples/shared

const stubClient = createStubClient({
  freeTierLimit: 5, // 5 free calls per day
  debug: true, // Enable debug logging
})

const solvaPay = createSolvaPay({
  apiClient: stubClient,
})
```

## Stub Client Configuration

### Basic Configuration

```typescript
import { createStubClient } from './stub-api-client'

const stubClient = createStubClient({
  // Number of free calls per day per plan
  freeTierLimit: 3,

  // Enable debug logging
  debug: true,

  // Use file-based persistence (default: false, in-memory only)
  useFileStorage: false,

  // Directory for persistent data (when useFileStorage is true)
  dataDir: '.test-data',
})
```

### Advanced Configuration

```typescript
const stubClient = createStubClient({
  freeTierLimit: 10,
  debug: true,
  useFileStorage: true,
  dataDir: '.test-data',

  // Simulate API delays (milliseconds)
  delays: {
    checkLimits: 100,
    trackUsage: 50,
    customer: 50,
  },

  // Base URL for checkout URLs
  baseUrl: 'http://localhost:3000',
})
```

## Testing Strategies

### Unit Tests

Test individual functions with stub mode:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createSolvaPay } from '@solvapay/server'
import { createStubClient } from './stub-api-client'

describe('Task Creation', () => {
  let solvaPay: ReturnType<typeof createSolvaPay>
  let payable: ReturnType<typeof solvaPay.payable>

  beforeEach(() => {
    const stubClient = createStubClient({
      freeTierLimit: 5,
      useFileStorage: false, // In-memory for tests
    })

    solvaPay = createSolvaPay({ apiClient: stubClient })
    payable = solvaPay.payable({
      product: 'prd_test',
      plan: 'pln_test',
    })
  })

  it('should create task within free tier', async () => {
    const createTask = async () => ({ success: true, task: { id: '1' } })
    const handler = payable.http(createTask)

    const result = await handler(
      { body: { title: 'Test' }, headers: { 'x-customer-ref': 'user_1' } },
      {},
    )

    expect(result.success).toBe(true)
  })

  it('should trigger paywall after free tier limit', async () => {
    const createTask = async () => ({ success: true, task: { id: '1' } })
    const handler = payable.http(createTask)
    const req = { body: {}, headers: { 'x-customer-ref': 'user_1' } }
    const res = {}

    // Make requests up to free tier limit
    for (let i = 0; i < 5; i++) {
      await handler(req, res)
    }

    // Next request should trigger paywall
    await expect(handler(req, res)).rejects.toThrow('Payment required')
  })
})
```

### Integration Tests

Test full API flows:

```typescript
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSolvaPay } from '@solvapay/server'
import { createStubClient } from './stub-api-client'

describe('API Integration', () => {
  let app: express.Application

  beforeEach(() => {
    app = express()
    app.use(express.json())

    const stubClient = createStubClient({ freeTierLimit: 3 })
    const solvaPay = createSolvaPay({ apiClient: stubClient })
    const payable = solvaPay.payable({ product: 'prd_test', plan: 'pln_test' })

    app.post(
      '/api/tasks',
      payable.http(async req => {
        return { success: true, task: { title: req.body.title } }
      }),
    )
  })

  it('should handle requests within free tier', async () => {
    const response = await request(app)
      .post('/api/tasks')
      .set('x-customer-ref', 'user_1')
      .send({ title: 'Test Task' })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
  })

  it('should return 402 after free tier limit', async () => {
    const customerRef = 'user_2'

    // Exhaust free tier
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/tasks')
        .set('x-customer-ref', customerRef)
        .send({ title: `Task ${i}` })
    }

    // Next request should hit paywall
    const response = await request(app)
      .post('/api/tasks')
      .set('x-customer-ref', customerRef)
      .send({ title: 'Task 4' })

    expect(response.status).toBe(402)
    expect(response.body.error).toBe('Payment required')
    expect(response.body.checkoutUrl).toBeDefined()
  })
})
```

### Testing Different Scenarios

#### Test Free Tier Behavior

```typescript
it('should track free tier usage per customer', async () => {
  const stubClient = createStubClient({ freeTierLimit: 3 })
  const solvaPay = createSolvaPay({ apiClient: stubClient })
  const payable = solvaPay.payable({ product: 'prd_test', plan: 'pln_test' })

  const handler = payable.http(async () => ({ success: true }))
  const req = { body: {}, headers: {} }
  const res = {}

  // Customer 1 uses free tier
  req.headers['x-customer-ref'] = 'user_1'
  await handler(req, res)
  await handler(req, res)
  await handler(req, res)

  // Customer 2 should have separate free tier
  req.headers['x-customer-ref'] = 'user_2'
  await handler(req, res) // Should work

  // Customer 1 should hit paywall
  req.headers['x-customer-ref'] = 'user_1'
  await expect(handler(req, res)).rejects.toThrow('Payment required')
})
```

#### Test Customer Creation

```typescript
it('should create customers automatically', async () => {
  const stubClient = createStubClient()
  const solvaPay = createSolvaPay({ apiClient: stubClient })

  // Customer is created on first use
  const customer = await solvaPay.ensureCustomer('user_123', 'user_123')
  expect(customer).toBeDefined()
})
```

#### Test Paywall Error Structure

```typescript
it('should throw PaywallError with structured content', async () => {
  const stubClient = createStubClient({ freeTierLimit: 1 })
  const solvaPay = createSolvaPay({ apiClient: stubClient })
  const payable = solvaPay.payable({ product: 'prd_test', plan: 'pln_test' })

  const handler = payable.http(async () => ({ success: true }))
  const req = { body: {}, headers: { 'x-customer-ref': 'user_1' } }
  const res = {}

  // First request works
  await handler(req, res)

  // Second request triggers paywall
  try {
    await handler(req, res)
    expect.fail('Should have thrown PaywallError')
  } catch (error) {
    expect(error).toBeInstanceOf(PaywallError)
    expect(error.structuredContent.checkoutUrl).toBeDefined()
    expect(error.structuredContent.product).toBe('prd_test')
  }
})
```

## Complete Examples

### Vitest Test Setup

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
})
```

```typescript
// __tests__/paywall.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createSolvaPay, PaywallError } from '@solvapay/server'
import { createStubClient } from '../../examples/shared/stub-api-client'

describe('Paywall Protection', () => {
  let solvaPay: ReturnType<typeof createSolvaPay>
  let payable: ReturnType<typeof solvaPay.payable>

  beforeEach(() => {
    const stubClient = createStubClient({
      freeTierLimit: 3,
      useFileStorage: false,
      debug: false,
    })

    solvaPay = createSolvaPay({ apiClient: stubClient })
    payable = solvaPay.payable({
      product: 'prd_test',
      plan: 'pln_test',
    })
  })

  describe('Free Tier', () => {
    it('should allow requests within free tier limit', async () => {
      const handler = payable.http(async () => ({ success: true }))
      const req = { body: {}, headers: { 'x-customer-ref': 'user_1' } }
      const res = {}

      // Should work for first 3 requests
      for (let i = 0; i < 3; i++) {
        const result = await handler(req, res)
        expect(result.success).toBe(true)
      }
    })

    it('should trigger paywall after free tier limit', async () => {
      const handler = payable.http(async () => ({ success: true }))
      const req = { body: {}, headers: { 'x-customer-ref': 'user_2' } }
      const res = {}

      // Exhaust free tier
      for (let i = 0; i < 3; i++) {
        await handler(req, res)
      }

      // Next request should fail
      await expect(handler(req, res)).rejects.toThrow(PaywallError)
    })
  })

  describe('Error Handling', () => {
    it('should include checkout URL in PaywallError', async () => {
      const stubClient = createStubClient({ freeTierLimit: 1 })
      const solvaPay = createSolvaPay({ apiClient: stubClient })
      const payable = solvaPay.payable({ product: 'prd_test', plan: 'pln_test' })

      const handler = payable.http(async () => ({ success: true }))
      const req = { body: {}, headers: { 'x-customer-ref': 'user_3' } }
      const res = {}

      await handler(req, res) // First request works

      try {
        await handler(req, res)
        expect.fail('Should have thrown')
      } catch (error) {
        if (error instanceof PaywallError) {
          expect(error.structuredContent.checkoutUrl).toBeDefined()
          expect(error.structuredContent.product).toBe('prd_test')
        }
      }
    })
  })
})
```

### Jest Test Setup

```typescript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
}
```

### Mock vs Stub

**Use Stub Mode When:**

- Testing paywall behavior
- Testing free tier limits
- Testing customer creation
- Integration testing without external dependencies

**Use Mocks When:**

- Testing error handling
- Testing specific API responses
- Unit testing individual functions

```typescript
// Example: Mock for specific error scenario
import { vi } from 'vitest'

it('should handle API errors', async () => {
  const mockClient = {
    checkLimits: vi.fn().mockRejectedValue(new Error('API Error')),
    trackUsage: vi.fn(),
    ensureCustomer: vi.fn().mockResolvedValue('cust_123'),
  }

  const solvaPay = createSolvaPay({ apiClient: mockClient })
  // Test error handling...
})
```

## Best Practices

1. **Use In-Memory Storage for Tests**: Set `useFileStorage: false` to avoid file system dependencies.

2. **Reset State Between Tests**: Create a new stub client in `beforeEach` to ensure test isolation.

3. **Test Edge Cases**: Test free tier limits, paywall triggers, and error scenarios.

4. **Use Realistic Limits**: Set `freeTierLimit` to realistic values (e.g., 3-5) for better test coverage.

5. **Test Error Structure**: Verify that `PaywallError` includes all expected properties.

6. **Clean Up**: If using file storage, clean up test data directories after tests.

## Next Steps

- [Error Handling Strategies](./error-handling.md) - Handle errors in tests
- [Performance Optimization](./performance.md) - Test performance
- [API Reference](../../packages/server/README.md) - Full API documentation
