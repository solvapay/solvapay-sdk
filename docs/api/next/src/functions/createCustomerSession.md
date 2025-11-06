[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / createCustomerSession

# Function: createCustomerSession()

> **createCustomerSession**(`request`, `options`): `Promise`\<`NextResponse`\<`unknown`\> \| \{ `customerUrl`: `string`; `sessionId`: `string`; \}\>

Defined in: [packages/next/src/helpers/checkout.ts:60](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/checkout.ts#L60)

Create customer session - Next.js wrapper

## Parameters

### request

`Request`

Next.js request object

### options

Configuration options

#### includeEmail?

`boolean`

#### includeName?

`boolean`

#### solvaPay?

[`SolvaPay`](../../../server/src/interfaces/SolvaPay.md)

## Returns

`Promise`\<`NextResponse`\<`unknown`\> \| \{ `customerUrl`: `string`; `sessionId`: `string`; \}\>

Customer session response or NextResponse error
