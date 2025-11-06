[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / SolvaPayClient

# Interface: SolvaPayClient

Defined in: [packages/server/src/types/client.ts:62](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L62)

SolvaPay API Client Interface

This interface defines the contract for communicating with the SolvaPay backend.
Uses auto-generated types from the OpenAPI specification.
You can provide your own implementation or use the default createSolvaPayClient().

## Methods

### cancelSubscription()?

> `optional` **cancelSubscription**(`params`): `Promise`\<\{ `agentName`: `string`; `agentRef`: `string`; `amount`: `number`; `cancellationReason?`: `string`; `cancelledAt?`: `string`; `createdAt`: `string`; `currency`: `string`; `customerEmail`: `string`; `customerName?`: `string`; `customerRef`: `string`; `endDate?`: `string`; `isRecurring`: `boolean`; `nextBillingDate?`: `string`; `paidAt?`: `string`; `planName`: `string`; `planRef`: `string`; `planType`: `"recurring"` \| `"usage-based"` \| `"one-time"` \| `"hybrid"`; `reference`: `string`; `startDate`: `string`; `status`: `"active"` \| `"expired"` \| `"pending"` \| `"cancelled"` \| `"suspended"` \| `"refunded"`; `usageQuota?`: `Record`\<`string`, `never`\>; \}\>

Defined in: [packages/server/src/types/client.ts:147](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L147)

#### Parameters

##### params

###### reason?

`string`

###### subscriptionRef

`string`

#### Returns

`Promise`\<\{ `agentName`: `string`; `agentRef`: `string`; `amount`: `number`; `cancellationReason?`: `string`; `cancelledAt?`: `string`; `createdAt`: `string`; `currency`: `string`; `customerEmail`: `string`; `customerName?`: `string`; `customerRef`: `string`; `endDate?`: `string`; `isRecurring`: `boolean`; `nextBillingDate?`: `string`; `paidAt?`: `string`; `planName`: `string`; `planRef`: `string`; `planType`: `"recurring"` \| `"usage-based"` \| `"one-time"` \| `"hybrid"`; `reference`: `string`; `startDate`: `string`; `status`: `"active"` \| `"expired"` \| `"pending"` \| `"cancelled"` \| `"suspended"` \| `"refunded"`; `usageQuota?`: `Record`\<`string`, `never`\>; \}\>

***

### checkLimits()

> **checkLimits**(`params`): `Promise`\<`LimitResponseWithPlan`\>

Defined in: [packages/server/src/types/client.ts:64](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L64)

#### Parameters

##### params

###### agentRef

`string`

**Description**

Agent reference identifier

**Example**

```ts
agt_1a2b3c4d5e6f
```

###### customerRef

`string`

**Description**

Customer reference identifier

**Example**

```ts
cus_3c4d5e6f7g8h
```

#### Returns

`Promise`\<`LimitResponseWithPlan`\>

***

### createAgent()?

> `optional` **createAgent**(`params`): `Promise`\<\{ `name`: `string`; `reference`: `string`; \}\>

Defined in: [packages/server/src/types/client.ts:98](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L98)

#### Parameters

##### params

`Record`\<`string`, `never`\>

#### Returns

`Promise`\<\{ `name`: `string`; `reference`: `string`; \}\>

***

### createCheckoutSession()

> **createCheckoutSession**(`params`): `Promise`\<\{ `checkoutUrl`: `string`; `sessionId`: `string`; \}\>

Defined in: [packages/server/src/types/client.ts:161](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L161)

#### Parameters

##### params

###### agentRef

`string`

**Description**

Agent reference identifier

**Example**

```ts
agt_1a2b3c4d5e6f
```

###### customerRef

`string`

**Description**

Customer reference identifier

**Example**

```ts
cus_3c4d5e6f7g8h
```

###### planRef?

`string`

**Description**

Plan reference identifier (optional)

**Example**

```ts
pln_2b3c4d5e6f7g
```

###### returnUrl?

`string`

**Description**

URL to redirect to after successful payment (optional)

**Example**

```ts
https://example.com/payment-success
```

#### Returns

`Promise`\<\{ `checkoutUrl`: `string`; `sessionId`: `string`; \}\>

***

### createCustomer()?

> `optional` **createCustomer**(`params`): `Promise`\<\{ `customerRef`: `string`; \}\>

Defined in: [packages/server/src/types/client.ts:74](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L74)

#### Parameters

##### params

###### email

`string`

**Description**

Customer email address (required)

**Example**

```ts
customer@example.com
```

###### externalRef?

`string`

**Description**

External reference ID from your auth system to map this customer to an auth user (optional)

**Example**

```ts
auth_user_12345
```

###### name?

`string`

**Description**

Customer full name (optional)

**Example**

```ts
John Doe
```

#### Returns

`Promise`\<\{ `customerRef`: `string`; \}\>

***

### createCustomerSession()

> **createCustomerSession**(`params`): `Promise`\<\{ `customerUrl`: `string`; `sessionId`: `string`; \}\>

Defined in: [packages/server/src/types/client.ts:164](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L164)

#### Parameters

##### params

###### customerRef

`string`

**Description**

Customer reference identifier

**Example**

```ts
cus_3c4d5e6f7g8h
```

#### Returns

`Promise`\<\{ `customerUrl`: `string`; `sessionId`: `string`; \}\>

***

### createPaymentIntent()?

> `optional` **createPaymentIntent**(`params`): `Promise`\<\{ `accountId?`: `string`; `clientSecret`: `string`; `id`: `string`; `publishableKey`: `string`; \}\>

Defined in: [packages/server/src/types/client.ts:134](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L134)

#### Parameters

##### params

###### agentRef

`string`

###### customerRef

`string`

###### idempotencyKey?

`string`

###### planRef

`string`

#### Returns

`Promise`\<\{ `accountId?`: `string`; `clientSecret`: `string`; `id`: `string`; `publishableKey`: `string`; \}\>

***

### createPlan()?

> `optional` **createPlan**(`params`): `Promise`\<\{ `name`: `string`; `reference`: `string`; \}\>

Defined in: [packages/server/src/types/client.ts:123](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L123)

#### Parameters

##### params

`Record`\<`string`, `never`\> & `object`

#### Returns

`Promise`\<\{ `name`: `string`; `reference`: `string`; \}\>

***

### deleteAgent()?

> `optional` **deleteAgent**(`agentRef`): `Promise`\<`void`\>

Defined in: [packages/server/src/types/client.ts:106](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L106)

#### Parameters

##### agentRef

`string`

#### Returns

`Promise`\<`void`\>

***

### deletePlan()?

> `optional` **deletePlan**(`agentRef`, `planRef`): `Promise`\<`void`\>

Defined in: [packages/server/src/types/client.ts:131](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L131)

#### Parameters

##### agentRef

`string`

##### planRef

`string`

#### Returns

`Promise`\<`void`\>

***

### getCustomer()?

> `optional` **getCustomer**(`params`): `Promise`\<[`CustomerResponseMapped`](../type-aliases/CustomerResponseMapped.md)\>

Defined in: [packages/server/src/types/client.ts:79](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L79)

#### Parameters

##### params

###### customerRef

`string`

#### Returns

`Promise`\<[`CustomerResponseMapped`](../type-aliases/CustomerResponseMapped.md)\>

***

### getCustomerByExternalRef()?

> `optional` **getCustomerByExternalRef**(`params`): `Promise`\<[`CustomerResponseMapped`](../type-aliases/CustomerResponseMapped.md)\>

Defined in: [packages/server/src/types/client.ts:84](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L84)

#### Parameters

##### params

###### externalRef

`string`

#### Returns

`Promise`\<[`CustomerResponseMapped`](../type-aliases/CustomerResponseMapped.md)\>

***

### listAgents()?

> `optional` **listAgents**(): `Promise`\<`object`[]\>

Defined in: [packages/server/src/types/client.ts:91](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L91)

#### Returns

`Promise`\<`object`[]\>

***

### listPlans()?

> `optional` **listPlans**(`agentRef`): `Promise`\<`object`[]\>

Defined in: [packages/server/src/types/client.ts:109](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L109)

#### Parameters

##### agentRef

`string`

#### Returns

`Promise`\<`object`[]\>

***

### processPayment()?

> `optional` **processPayment**(`params`): `Promise`\<[`ProcessPaymentResult`](ProcessPaymentResult.md)\>

Defined in: [packages/server/src/types/client.ts:153](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L153)

#### Parameters

##### params

###### agentRef

`string`

###### customerRef

`string`

###### paymentIntentId

`string`

###### planRef?

`string`

#### Returns

`Promise`\<[`ProcessPaymentResult`](ProcessPaymentResult.md)\>

***

### trackUsage()

> **trackUsage**(`params`): `Promise`\<`void`\>

Defined in: [packages/server/src/types/client.ts:69](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L69)

#### Parameters

##### params

`object` & `object`

#### Returns

`Promise`\<`void`\>
