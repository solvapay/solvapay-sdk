[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / createPaymentIntentCore

# Function: createPaymentIntentCore()

> **createPaymentIntentCore**(`request`, `body`, `options`): `Promise`\<[`ErrorResult`](../interfaces/ErrorResult.md) \| \{ `accountId?`: `string`; `clientSecret`: `string`; `customerRef`: `string`; `id`: `string`; `publishableKey`: `string`; \}\>

Defined in: [packages/server/src/helpers/payment.ts:54](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/helpers/payment.ts#L54)

Create a Stripe payment intent for a customer to subscribe to a plan.

This is a framework-agnostic helper that:
1. Extracts authenticated user from the request
2. Syncs customer with SolvaPay backend
3. Creates a payment intent for the specified plan

The payment intent can then be confirmed on the client side using Stripe.js.
After confirmation, use `processPaymentCore()` to complete the subscription.

## Parameters

### request

`Request`

Standard Web API Request object

### body

Payment intent parameters

#### agentRef

`string`

Agent reference (required)

#### planRef

`string`

Plan reference to subscribe to (required)

### options

Configuration options

#### includeEmail?

`boolean`

Whether to include email in customer data (default: true)

#### includeName?

`boolean`

Whether to include name in customer data (default: true)

#### solvaPay?

[`SolvaPay`](../interfaces/SolvaPay.md)

Optional SolvaPay instance (creates new one if not provided)

## Returns

`Promise`\<[`ErrorResult`](../interfaces/ErrorResult.md) \| \{ `accountId?`: `string`; `clientSecret`: `string`; `customerRef`: `string`; `id`: `string`; `publishableKey`: `string`; \}\>

Payment intent response with client secret and customer reference, or error result

## Example

```typescript
// In an API route handler
export async function POST(request: Request) {
  const body = await request.json();
  const result = await createPaymentIntentCore(request, body);
  
  if (isErrorResult(result)) {
    return Response.json(result, { status: result.status });
  }
  
  return Response.json(result);
}
```

## See

 - [processPaymentCore](processPaymentCore.md) for processing confirmed payments
 - [ErrorResult](../interfaces/ErrorResult.md) for error handling

## Since

1.0.0
