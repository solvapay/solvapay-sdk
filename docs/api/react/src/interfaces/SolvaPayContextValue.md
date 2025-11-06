[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / SolvaPayContextValue

# Interface: SolvaPayContextValue

Defined in: [packages/react/src/types/index.ts:136](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L136)

## Properties

### createPayment()

> **createPayment**: (`params`) => `Promise`\<[`PaymentIntentResult`](PaymentIntentResult.md)\>

Defined in: [packages/react/src/types/index.ts:139](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L139)

#### Parameters

##### params

###### agentRef?

`string`

###### planRef

`string`

#### Returns

`Promise`\<[`PaymentIntentResult`](PaymentIntentResult.md)\>

***

### customerRef?

> `optional` **customerRef**: `string`

Defined in: [packages/react/src/types/index.ts:145](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L145)

***

### processPayment()?

> `optional` **processPayment**: (`params`) => `Promise`\<[`ProcessPaymentResult`](../../../server/src/interfaces/ProcessPaymentResult.md)\>

Defined in: [packages/react/src/types/index.ts:140](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L140)

#### Parameters

##### params

###### agentRef

`string`

###### paymentIntentId

`string`

###### planRef?

`string`

#### Returns

`Promise`\<[`ProcessPaymentResult`](../../../server/src/interfaces/ProcessPaymentResult.md)\>

***

### refetchSubscription()

> **refetchSubscription**: () => `Promise`\<`void`\>

Defined in: [packages/react/src/types/index.ts:138](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L138)

#### Returns

`Promise`\<`void`\>

***

### subscription

> **subscription**: [`SubscriptionStatus`](SubscriptionStatus.md)

Defined in: [packages/react/src/types/index.ts:137](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L137)

***

### updateCustomerRef()?

> `optional` **updateCustomerRef**: (`newCustomerRef`) => `void`

Defined in: [packages/react/src/types/index.ts:146](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L146)

#### Parameters

##### newCustomerRef

`string`

#### Returns

`void`
