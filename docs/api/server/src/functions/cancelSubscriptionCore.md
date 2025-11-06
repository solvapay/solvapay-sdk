[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / cancelSubscriptionCore

# Function: cancelSubscriptionCore()

> **cancelSubscriptionCore**(`request`, `body`, `options`): `Promise`\<`any`\>

Defined in: [packages/server/src/helpers/subscription.ts:23](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/helpers/subscription.ts#L23)

Cancel subscription - core implementation

## Parameters

### request

`Request`

Standard Web API Request

### body

Cancellation parameters

#### reason?

`string`

#### subscriptionRef

`string`

### options

Configuration options

#### solvaPay?

[`SolvaPay`](../interfaces/SolvaPay.md)

## Returns

`Promise`\<`any`\>

Cancelled subscription response or error result
