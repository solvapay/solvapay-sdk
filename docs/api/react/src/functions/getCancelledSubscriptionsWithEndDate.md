[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / getCancelledSubscriptionsWithEndDate

# Function: getCancelledSubscriptionsWithEndDate()

> **getCancelledSubscriptionsWithEndDate**(`subscriptions`): [`SubscriptionInfo`](../interfaces/SubscriptionInfo.md)[]

Defined in: [packages/react/src/utils/subscriptions.ts:40](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/utils/subscriptions.ts#L40)

Get cancelled subscriptions with valid endDate (not expired)

Returns subscriptions with cancelledAt set and status === 'active' that have a future endDate.
Backend keeps cancelled subscriptions as 'active' until expiration.

## Parameters

### subscriptions

[`SubscriptionInfo`](../interfaces/SubscriptionInfo.md)[]

## Returns

[`SubscriptionInfo`](../interfaces/SubscriptionInfo.md)[]
