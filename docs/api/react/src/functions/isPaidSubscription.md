[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / isPaidSubscription

# Function: isPaidSubscription()

> **isPaidSubscription**(`sub`): `boolean`

Defined in: [packages/react/src/utils/subscriptions.ts:89](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/utils/subscriptions.ts#L89)

Check if a subscription is paid
Uses subscription amount field: amount > 0 = paid, amount === 0 or undefined = free

## Parameters

### sub

[`SubscriptionInfo`](../interfaces/SubscriptionInfo.md)

Subscription to check

## Returns

`boolean`

true if subscription is paid (amount > 0)
