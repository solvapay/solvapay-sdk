[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / ProcessPaymentResult

# Interface: ProcessPaymentResult

Defined in: [packages/server/src/types/client.ts:48](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L48)

Result from processing a payment intent

## Properties

### purchase?

> `optional` **purchase**: [`PurchaseInfo`](PurchaseInfo.md)

Defined in: [packages/server/src/types/client.ts:51](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L51)

***

### status

> **status**: `"completed"`

Defined in: [packages/server/src/types/client.ts:52](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L52)

***

### subscription?

> `optional` **subscription**: `object`

Defined in: [packages/server/src/types/client.ts:50](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L50)

#### agentName

> **agentName**: `string`

##### Description

Agent name

##### Example

```ts
AI Assistant
```

#### amount

> **amount**: `number`

##### Description

Amount paid in original currency (in cents)

##### Example

```ts
9900
```

#### cancellationReason?

> `optional` **cancellationReason**: `string`

##### Description

Reason for cancellation

##### Example

```ts
Customer request
```

#### cancelledAt?

> `optional` **cancelledAt**: `string`

##### Description

When subscription was cancelled

##### Example

```ts
2025-10-28T10:00:00Z
```

#### currency

> **currency**: `string`

##### Description

Currency code

##### Example

```ts
USD
```

#### endDate?

> `optional` **endDate**: `string`

##### Description

End date of subscription

##### Example

```ts
2025-11-27T10:00:00Z
```

#### planName

> **planName**: `string`

##### Description

Plan name

##### Example

```ts
Pro Plan
```

#### reference

> **reference**: `string`

##### Description

Subscription reference

##### Example

```ts
sub_abc123
```

#### startDate

> **startDate**: `string`

##### Description

Start date

##### Example

```ts
2025-10-27T10:00:00Z
```

#### status

> **status**: `string`

##### Description

Subscription status

##### Example

```ts
active
```

***

### type

> **type**: `"subscription"` \| `"purchase"`

Defined in: [packages/server/src/types/client.ts:49](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/types/client.ts#L49)
