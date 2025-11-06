[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [core/src](../README.md) / SolvaPayError

# Class: SolvaPayError

Defined in: [packages/core/src/index.ts:34](https://github.com/solvapay/solvapay-sdk/blob/main/packages/core/src/index.ts#L34)

Base error class for SolvaPay SDK errors.

All SolvaPay SDK errors extend this class, making it easy to catch
and handle SDK-specific errors separately from other errors.

## Example

```typescript
import { SolvaPayError } from '@solvapay/core';

try {
  const config = getSolvaPayConfig();
} catch (error) {
  if (error instanceof SolvaPayError) {
    // Handle SolvaPay-specific error
    console.error('SolvaPay error:', error.message);
  } else {
    // Handle other errors
    throw error;
  }
}
```

## Since

1.0.0

## Extends

- `Error`

## Constructors

### Constructor

> **new SolvaPayError**(`message`): `SolvaPayError`

Defined in: [packages/core/src/index.ts:40](https://github.com/solvapay/solvapay-sdk/blob/main/packages/core/src/index.ts#L40)

Creates a new SolvaPayError instance.

#### Parameters

##### message

`string`

Error message

#### Returns

`SolvaPayError`

#### Overrides

`Error.constructor`
