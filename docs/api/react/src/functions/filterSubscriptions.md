[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / filterSubscriptions

# Function: filterSubscriptions()

> **filterSubscriptions**(`subscriptions`): [`SubscriptionInfo`](../interfaces/SubscriptionInfo.md)[]

Defined in: [packages/react/src/utils/subscriptions.ts:19](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/utils/subscriptions.ts#L19)

Filter subscriptions to only include active ones

Rules:
- Keep subscriptions with status === 'active'
- Filter out subscriptions with status === 'cancelled', 'expired', 'suspended', 'refunded', etc.

Note: Backend now keeps subscriptions with status 'active' until expiration,
even when cancelled. Cancellation is tracked via cancelledAt field.

## Parameters

### subscriptions

[`SubscriptionInfo`](../interfaces/SubscriptionInfo.md)[]

## Returns

[`SubscriptionInfo`](../interfaces/SubscriptionInfo.md)[]
