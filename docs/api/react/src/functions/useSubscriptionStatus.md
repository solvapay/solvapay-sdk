[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / useSubscriptionStatus

# Function: useSubscriptionStatus()

> **useSubscriptionStatus**(): [`SubscriptionStatusReturn`](../interfaces/SubscriptionStatusReturn.md)

Defined in: [packages/react/src/hooks/useSubscriptionStatus.ts:21](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/hooks/useSubscriptionStatus.ts#L21)

Hook providing advanced status and helper functions for subscription management

Focuses on cancelled subscription logic and date formatting utilities.
For basic subscription data and paid status checks, use useSubscription() instead.

## Returns

[`SubscriptionStatusReturn`](../interfaces/SubscriptionStatusReturn.md)

## Example

```tsx
const { cancelledSubscription, shouldShowCancelledNotice, formatDate, getDaysUntilExpiration } = useSubscriptionStatus();

if (shouldShowCancelledNotice && cancelledSubscription) {
  const formattedDate = formatDate(cancelledSubscription.endDate);
  const daysLeft = getDaysUntilExpiration(cancelledSubscription.endDate);
}
```
