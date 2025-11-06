[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / createCheckoutSessionCore

# Function: createCheckoutSessionCore()

> **createCheckoutSessionCore**(`request`, `body`, `options`): `Promise`\<[`ErrorResult`](../interfaces/ErrorResult.md) \| \{ `checkoutUrl`: `string`; `sessionId`: `string`; \}\>

Defined in: [packages/server/src/helpers/checkout.ts:22](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/helpers/checkout.ts#L22)

Create checkout session - core implementation

## Parameters

### request

`Request`

Standard Web API Request

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

[`SolvaPay`](../interfaces/SolvaPay.md)

## Returns

`Promise`\<[`ErrorResult`](../interfaces/ErrorResult.md) \| \{ `checkoutUrl`: `string`; `sessionId`: `string`; \}\>

Checkout session response or error result
