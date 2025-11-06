[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / PaywallError

# Class: PaywallError

Defined in: [packages/server/src/paywall.ts:62](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/paywall.ts#L62)

Error thrown when a paywall is triggered (subscription required or usage limit exceeded).

This error is automatically thrown by the paywall protection system when:
- Customer doesn't have required subscription
- Customer has exceeded usage limits
- Customer needs to upgrade their plan

The error includes structured content with checkout URLs and metadata for
building custom paywall UIs.

## Example

```typescript
import { PaywallError } from '@solvapay/server';

try {
  const result = await payable.http(createTask)(req, res);
  return result;
} catch (error) {
  if (error instanceof PaywallError) {
    // Custom paywall handling
    return res.status(402).json({
      error: error.message,
      checkoutUrl: error.structuredContent.checkoutUrl,
      // Additional metadata available in error.structuredContent
    });
  }
  throw error;
}
```

## See

[PaywallStructuredContent](../interfaces/PaywallStructuredContent.md) for the structured content format

## Since

1.0.0

## Extends

- `Error`

## Constructors

### Constructor

> **new PaywallError**(`message`, `structuredContent`): `PaywallError`

Defined in: [packages/server/src/paywall.ts:69](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/paywall.ts#L69)

Creates a new PaywallError instance.

#### Parameters

##### message

`string`

Error message

##### structuredContent

[`PaywallStructuredContent`](../interfaces/PaywallStructuredContent.md)

Structured content with checkout URLs and metadata

#### Returns

`PaywallError`

#### Overrides

`Error.constructor`

## Properties

### structuredContent

> **structuredContent**: [`PaywallStructuredContent`](../interfaces/PaywallStructuredContent.md)

Defined in: [packages/server/src/paywall.ts:71](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/paywall.ts#L71)

Structured content with checkout URLs and metadata
