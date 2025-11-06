[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / processPaymentCore

# Function: processPaymentCore()

> **processPaymentCore**(`request`, `body`, `options`): `Promise`\<[`ProcessPaymentResult`](../interfaces/ProcessPaymentResult.md) \| [`ErrorResult`](../interfaces/ErrorResult.md)\>

Defined in: [packages/server/src/helpers/payment.ts:158](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/helpers/payment.ts#L158)

Process a payment intent after client-side Stripe confirmation.

This helper processes a payment intent that has been confirmed on the client
side using Stripe.js. It creates the subscription or purchase immediately,
eliminating webhook delay.

Call this after the client has confirmed the payment intent with Stripe.js.

## Parameters

### request

`Request`

Standard Web API Request object

### body

Payment processing parameters

#### agentRef

`string`

Agent reference (required)

#### paymentIntentId

`string`

Stripe payment intent ID from client confirmation (required)

#### planRef?

`string`

Optional plan reference (if not in payment intent)

### options

Configuration options

#### solvaPay?

[`SolvaPay`](../interfaces/SolvaPay.md)

Optional SolvaPay instance (creates new one if not provided)

## Returns

`Promise`\<[`ProcessPaymentResult`](../interfaces/ProcessPaymentResult.md) \| [`ErrorResult`](../interfaces/ErrorResult.md)\>

Process payment result with subscription details, or error result

## Example

```typescript
// In an API route handler
export async function POST(request: Request) {
  const body = await request.json();
  const result = await processPaymentCore(request, body);
  
  if (isErrorResult(result)) {
    return Response.json(result, { status: result.status });
  }
  
  if (result.success) {
    console.log('Subscription created:', result.subscriptionRef);
  }
  
  return Response.json(result);
}
```

## See

 - [createPaymentIntentCore](createPaymentIntentCore.md) for creating payment intents
 - [ErrorResult](../interfaces/ErrorResult.md) for error handling

## Since

1.0.0
