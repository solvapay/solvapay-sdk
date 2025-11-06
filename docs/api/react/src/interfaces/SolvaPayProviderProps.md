[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / SolvaPayProviderProps

# Interface: SolvaPayProviderProps

Defined in: [packages/react/src/types/index.ts:149](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L149)

## Properties

### checkSubscription()?

> `optional` **checkSubscription**: () => `Promise`\<[`CustomerSubscriptionData`](CustomerSubscriptionData.md)\>

Defined in: [packages/react/src/types/index.ts:161](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L161)

#### Returns

`Promise`\<[`CustomerSubscriptionData`](CustomerSubscriptionData.md)\>

***

### children

> **children**: `ReactNode`

Defined in: [packages/react/src/types/index.ts:168](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L168)

***

### config?

> `optional` **config**: [`SolvaPayConfig`](SolvaPayConfig.md)

Defined in: [packages/react/src/types/index.ts:154](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L154)

Configuration object with sensible defaults
If not provided, uses standard Next.js API routes

***

### createPayment()?

> `optional` **createPayment**: (`params`) => `Promise`\<[`PaymentIntentResult`](PaymentIntentResult.md)\>

Defined in: [packages/react/src/types/index.ts:160](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L160)

Custom API functions (override config defaults)
Use only if you need custom logic beyond standard API routes

#### Parameters

##### params

###### agentRef?

`string`

###### planRef

`string`

#### Returns

`Promise`\<[`PaymentIntentResult`](PaymentIntentResult.md)\>

***

### processPayment()?

> `optional` **processPayment**: (`params`) => `Promise`\<[`ProcessPaymentResult`](../../../server/src/interfaces/ProcessPaymentResult.md)\>

Defined in: [packages/react/src/types/index.ts:162](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L162)

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
