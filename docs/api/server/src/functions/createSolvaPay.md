[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / createSolvaPay

# Function: createSolvaPay()

> **createSolvaPay**(`config?`): [`SolvaPay`](../interfaces/SolvaPay.md)

Defined in: [packages/server/src/factory.ts:560](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L560)

Create a SolvaPay instance with paywall protection capabilities.

This factory function creates a SolvaPay instance that can be used to
protect API endpoints, functions, and MCP tools with usage limits and
subscription checks.

## Parameters

### config?

[`CreateSolvaPayConfig`](../interfaces/CreateSolvaPayConfig.md)

Optional configuration object

## Returns

[`SolvaPay`](../interfaces/SolvaPay.md)

SolvaPay instance with payable() method and API client access

## Example

```typescript
// Production: Use environment variable (recommended)
const solvaPay = createSolvaPay();

// Production: Pass API key explicitly
const solvaPay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY
});

// Testing: Use mock client
const solvaPay = createSolvaPay({
  apiClient: mockClient
});

// Create payable handlers for your agent
const payable = solvaPay.payable({ 
  agent: 'agt_myapi', 
  plan: 'pln_premium' 
});

// Protect endpoints with framework-specific adapters
app.post('/tasks', payable.http(createTask));      // Express/Fastify
export const POST = payable.next(createTask);      // Next.js App Router
const handler = payable.mcp(createTask);           // MCP servers
```

## See

 - [SolvaPay](../interfaces/SolvaPay.md) for the returned instance interface
 - [CreateSolvaPayConfig](../interfaces/CreateSolvaPayConfig.md) for configuration options

## Since

1.0.0
