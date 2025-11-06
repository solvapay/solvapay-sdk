[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / processPayment

# Function: processPayment()

> **processPayment**(`request`, `body`, `options`): `Promise`\<[`ProcessPaymentResult`](../../../server/src/interfaces/ProcessPaymentResult.md) \| `NextResponse`\<`unknown`\>\>

Defined in: [packages/next/src/helpers/payment.ts:74](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/payment.ts#L74)

Process payment - Next.js wrapper

## Parameters

### request

`Request`

Next.js request object

### body

Payment processing parameters

#### agentRef

`string`

#### paymentIntentId

`string`

#### planRef?

`string`

### options

Configuration options

#### solvaPay?

[`SolvaPay`](../../../server/src/interfaces/SolvaPay.md)

## Returns

`Promise`\<[`ProcessPaymentResult`](../../../server/src/interfaces/ProcessPaymentResult.md) \| `NextResponse`\<`unknown`\>\>

Process payment result or NextResponse error
