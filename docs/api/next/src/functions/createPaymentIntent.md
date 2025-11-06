[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / createPaymentIntent

# Function: createPaymentIntent()

> **createPaymentIntent**(`request`, `body`, `options`): `Promise`\<`NextResponse`\<`unknown`\> \| \{ `accountId?`: `string`; `clientSecret`: `string`; `customerRef`: `string`; `id`: `string`; `publishableKey`: `string`; \}\>

Defined in: [packages/next/src/helpers/payment.ts:26](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/payment.ts#L26)

Create payment intent - Next.js wrapper

## Parameters

### request

`Request`

Next.js request object

### body

Payment intent parameters

#### agentRef

`string`

#### planRef

`string`

### options

Configuration options

#### includeEmail?

`boolean`

#### includeName?

`boolean`

#### solvaPay?

[`SolvaPay`](../../../server/src/interfaces/SolvaPay.md)

## Returns

`Promise`\<`NextResponse`\<`unknown`\> \| \{ `accountId?`: `string`; `clientSecret`: `string`; `customerRef`: `string`; `id`: `string`; `publishableKey`: `string`; \}\>

Payment intent response or NextResponse error
