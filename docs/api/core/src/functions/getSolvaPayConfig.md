[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [core/src](../README.md) / getSolvaPayConfig

# Function: getSolvaPayConfig()

> **getSolvaPayConfig**(): [`SolvaPayConfig`](../interfaces/SolvaPayConfig.md)

Defined in: [packages/core/src/index.ts:76](https://github.com/solvapay/solvapay-sdk/blob/main/packages/core/src/index.ts#L76)

Validates and returns SolvaPay configuration from environment variables.

Reads `SOLVAPAY_SECRET_KEY` and optional `SOLVAPAY_API_BASE_URL` from
environment variables and returns a validated configuration object.

## Returns

[`SolvaPayConfig`](../interfaces/SolvaPayConfig.md)

SolvaPayConfig object with apiKey and optional apiBaseUrl

## Throws

If SOLVAPAY_SECRET_KEY is missing

## Example

```typescript
import { getSolvaPayConfig } from '@solvapay/core';

try {
  const config = getSolvaPayConfig();
  console.log('API Key configured:', config.apiKey);
} catch (error) {
  console.error('Configuration error:', error.message);
}
```

## See

 - [SolvaPayConfig](../interfaces/SolvaPayConfig.md) for the return type
 - [SolvaPayError](../classes/SolvaPayError.md) for error handling

## Since

1.0.0
