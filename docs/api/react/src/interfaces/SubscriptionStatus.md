[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / SubscriptionStatus

# Interface: SubscriptionStatus

Defined in: [packages/react/src/types/index.ts:35](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L35)

## Properties

### activePaidSubscription

> **activePaidSubscription**: [`SubscriptionInfo`](SubscriptionInfo.md) \| `null`

Defined in: [packages/react/src/types/index.ts:59](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L59)

Most recent active paid subscription (sorted by startDate)
Returns subscription with status === 'active' and amount > 0.
null if no active paid subscription exists

***

### activeSubscription

> **activeSubscription**: [`SubscriptionInfo`](SubscriptionInfo.md) \| `null`

Defined in: [packages/react/src/types/index.ts:47](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L47)

Primary active subscription (paid or free) - most recent subscription with status === 'active'
Backend keeps subscriptions as 'active' until expiration, even when cancelled.
null if no active subscription exists

***

### customerRef?

> `optional` **customerRef**: `string`

Defined in: [packages/react/src/types/index.ts:37](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L37)

***

### email?

> `optional` **email**: `string`

Defined in: [packages/react/src/types/index.ts:38](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L38)

***

### hasPaidSubscription

> **hasPaidSubscription**: `boolean`

Defined in: [packages/react/src/types/index.ts:53](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L53)

Check if user has any active paid subscription (amount > 0)
Checks subscriptions with status === 'active'.
Backend keeps subscriptions as 'active' until expiration, even when cancelled.

***

### hasPlan()

> **hasPlan**: (`planName`) => `boolean`

Defined in: [packages/react/src/types/index.ts:41](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L41)

#### Parameters

##### planName

`string`

#### Returns

`boolean`

***

### loading

> **loading**: `boolean`

Defined in: [packages/react/src/types/index.ts:36](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L36)

***

### name?

> `optional` **name**: `string`

Defined in: [packages/react/src/types/index.ts:39](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L39)

***

### subscriptions

> **subscriptions**: [`SubscriptionInfo`](SubscriptionInfo.md)[]

Defined in: [packages/react/src/types/index.ts:40](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/types/index.ts#L40)
