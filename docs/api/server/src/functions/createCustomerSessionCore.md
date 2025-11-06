[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / createCustomerSessionCore

# Function: createCustomerSessionCore()

> **createCustomerSessionCore**(`request`, `options`): `Promise`\<[`ErrorResult`](../interfaces/ErrorResult.md) \| \{ `customerUrl`: `string`; `sessionId`: `string`; \}\>

Defined in: [packages/server/src/helpers/checkout.ts:101](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/helpers/checkout.ts#L101)

Create customer session - core implementation

## Parameters

### request

`Request`

Standard Web API Request

### options

Configuration options

#### includeEmail?

`boolean`

#### includeName?

`boolean`

#### solvaPay?

[`SolvaPay`](../interfaces/SolvaPay.md)

## Returns

`Promise`\<[`ErrorResult`](../interfaces/ErrorResult.md) \| \{ `customerUrl`: `string`; `sessionId`: `string`; \}\>

Customer session response or error result
