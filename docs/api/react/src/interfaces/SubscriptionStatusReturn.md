[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / SubscriptionStatusReturn

# Interface: SubscriptionStatusReturn

Defined in: [packages/react/src/types/index.ts:295](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L295)

Return type for useSubscriptionStatus hook

Provides advanced subscription status helpers and utilities.
Focuses on cancelled subscription logic and date formatting.
For basic subscription data and paid status, use useSubscription() instead.

## Properties

### cancelledSubscription

> **cancelledSubscription**: [`SubscriptionInfo`](SubscriptionInfo.md) \| `null`

Defined in: [packages/react/src/types/index.ts:300](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L300)

Most recent cancelled paid subscription (sorted by startDate)
null if no cancelled paid subscription exists

***

### formatDate()

> **formatDate**: (`dateString?`) => `string` \| `null`

Defined in: [packages/react/src/types/index.ts:310](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L310)

Format a date string to locale format (e.g., "January 15, 2024")
Returns null if dateString is not provided

#### Parameters

##### dateString?

`string`

#### Returns

`string` \| `null`

***

### getDaysUntilExpiration()

> **getDaysUntilExpiration**: (`endDate?`) => `number` \| `null`

Defined in: [packages/react/src/types/index.ts:315](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L315)

Calculate days until expiration date
Returns null if endDate is not provided, otherwise returns days (0 or positive)

#### Parameters

##### endDate?

`string`

#### Returns

`number` \| `null`

***

### shouldShowCancelledNotice

> **shouldShowCancelledNotice**: `boolean`

Defined in: [packages/react/src/types/index.ts:305](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L305)

Whether to show cancelled subscription notice
true if cancelledSubscription exists
