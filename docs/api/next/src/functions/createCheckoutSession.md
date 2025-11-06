[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / createCheckoutSession

# Function: createCheckoutSession()

> **createCheckoutSession**(`request`, `body`, `options`): `Promise`\<`NextResponse`\<`unknown`\> \| \{ `checkoutUrl`: `string`; `sessionId`: `string`; \}\>

Defined in: [packages/next/src/helpers/checkout.ts:24](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/checkout.ts#L24)

Create checkout session - Next.js wrapper

## Parameters

### request

`Request`

Next.js request object

### body

Checkout session parameters

#### agentRef

`string`

#### planRef?

`string`

#### returnUrl?

`string`

### options

Configuration options

#### includeEmail?

`boolean`

#### includeName?

`boolean`

#### returnUrl?

`string`

#### solvaPay?

[`SolvaPay`](../../../server/src/interfaces/SolvaPay.md)

## Returns

`Promise`\<`NextResponse`\<`unknown`\> \| \{ `checkoutUrl`: `string`; `sessionId`: `string`; \}\>

Checkout session response or NextResponse error
