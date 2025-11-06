[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / createSolvaPayClient

# Function: createSolvaPayClient()

> **createSolvaPayClient**(`opts`): [`SolvaPayClient`](../interfaces/SolvaPayClient.md)

Defined in: [packages/server/src/client.ts:62](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/client.ts#L62)

Creates a SolvaPay API client that implements the full SolvaPayClient interface.

This function creates a low-level API client for direct communication with the
SolvaPay backend. For most use cases, use `createSolvaPay()` instead, which
provides a higher-level API with paywall protection.

Use this function when you need:
- Direct API access for custom operations
- Testing with custom client implementations
- Advanced use cases not covered by the main API

## Parameters

### opts

[`ServerClientOptions`](../type-aliases/ServerClientOptions.md)

Configuration options

## Returns

[`SolvaPayClient`](../interfaces/SolvaPayClient.md)

A fully configured SolvaPayClient instance

## Throws

If API key is missing

## Example

```typescript
// Create API client directly
const client = createSolvaPayClient({
  apiKey: process.env.SOLVAPAY_SECRET_KEY!,
  apiBaseUrl: 'https://api.solvapay.com' // optional
});

// Use client for custom operations
const agents = await client.listAgents();
```

## See

 - [createSolvaPay](createSolvaPay.md) for the recommended high-level API
 - [ServerClientOptions](../type-aliases/ServerClientOptions.md) for configuration options

## Since

1.0.0
