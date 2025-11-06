[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [next/src](../README.md) / cancelSubscription

# Function: cancelSubscription()

> **cancelSubscription**(`request`, `body`, `options`): `Promise`\<`any`\>

Defined in: [packages/next/src/helpers/subscription.ts:25](https://github.com/solvapay/solvapay-sdk/blob/main/packages/next/src/helpers/subscription.ts#L25)

Cancel subscription - Next.js wrapper

## Parameters

### request

`Request`

Next.js request object

### body

Cancellation parameters

#### reason?

`string`

#### subscriptionRef

`string`

### options

Configuration options

#### solvaPay?

[`SolvaPay`](../../../server/src/interfaces/SolvaPay.md)

## Returns

`Promise`\<`any`\>

Cancelled subscription response or NextResponse error
