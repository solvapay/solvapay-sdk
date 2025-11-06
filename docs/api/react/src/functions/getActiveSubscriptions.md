[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / getActiveSubscriptions

# Function: getActiveSubscriptions()

> **getActiveSubscriptions**(`subscriptions`): [`SubscriptionInfo`](../interfaces/SubscriptionInfo.md)[]

Defined in: [packages/react/src/utils/subscriptions.ts:30](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/utils/subscriptions.ts#L30)

Get active subscriptions

Returns subscriptions with status === 'active'.
Note: Backend keeps subscriptions as 'active' until expiration, even when cancelled.
Use cancelledAt field to check if a subscription is cancelled.

## Parameters

### subscriptions

[`SubscriptionInfo`](../interfaces/SubscriptionInfo.md)[]

## Returns

[`SubscriptionInfo`](../interfaces/SubscriptionInfo.md)[]
