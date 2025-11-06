[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / getPrimarySubscription

# Function: getPrimarySubscription()

> **getPrimarySubscription**(`subscriptions`): [`SubscriptionInfo`](../interfaces/SubscriptionInfo.md) \| `null`

Defined in: [packages/react/src/utils/subscriptions.ts:70](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/utils/subscriptions.ts#L70)

Get the primary subscription to display

Prioritization:
1. Active subscriptions (most recent by startDate)
2. null if no valid subscriptions

Note: Backend keeps subscriptions as 'active' until expiration, so we only
need to check for active subscriptions. Cancelled subscriptions are still
active until their endDate.

## Parameters

### subscriptions

[`SubscriptionInfo`](../interfaces/SubscriptionInfo.md)[]

## Returns

[`SubscriptionInfo`](../interfaces/SubscriptionInfo.md) \| `null`
