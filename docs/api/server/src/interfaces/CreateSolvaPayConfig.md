[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / CreateSolvaPayConfig

# Interface: CreateSolvaPayConfig

Defined in: [packages/server/src/factory.ts:33](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L33)

Configuration for creating a SolvaPay instance.

You can provide either an `apiKey` (for production) or an `apiClient` (for testing).
If neither is provided, the SDK will attempt to read `SOLVAPAY_SECRET_KEY` from
environment variables. If no API key is found, the SDK runs in stub mode.

## Example

```typescript
// Production: Use API key
const config: CreateSolvaPayConfig = {
  apiKey: process.env.SOLVAPAY_SECRET_KEY
};

// Testing: Use mock client
const config: CreateSolvaPayConfig = {
  apiClient: mockClient
};
```

## Properties

### apiBaseUrl?

> `optional` **apiBaseUrl**: `string`

Defined in: [packages/server/src/factory.ts:50](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L50)

Optional API base URL override (only used with apiKey).
Defaults to production API URL if not provided.

***

### apiClient?

> `optional` **apiClient**: [`SolvaPayClient`](SolvaPayClient.md)

Defined in: [packages/server/src/factory.ts:44](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L44)

API client for testing or custom implementations.
Use this for stub mode, testing, or custom client implementations.

***

### apiKey?

> `optional` **apiKey**: `string`

Defined in: [packages/server/src/factory.ts:38](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L38)

API key for production use (creates client automatically).
Defaults to `SOLVAPAY_SECRET_KEY` environment variable if not provided.
