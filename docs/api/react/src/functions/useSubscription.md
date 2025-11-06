[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / useSubscription

# Function: useSubscription()

> **useSubscription**(): [`SubscriptionStatus`](../interfaces/SubscriptionStatus.md) & `object`

Defined in: [packages/react/src/hooks/useSubscription.ts:45](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/hooks/useSubscription.ts#L45)

Hook to get current subscription status and information.

Returns the current user's subscription status, including active
subscriptions, plan details, and payment information. Automatically
syncs with the SolvaPay backend and handles loading and error states.

## Returns

[`SubscriptionStatus`](../interfaces/SubscriptionStatus.md) & `object`

Subscription data and status

## Example

```tsx
import { useSubscription } from '@solvapay/react';

function Dashboard() {
  const { subscriptions, hasPaidSubscription, isLoading, refetch } = useSubscription();

  if (isLoading) return <Spinner />;

  if (!hasPaidSubscription) {
    return <UpgradePrompt />;
  }

  return (
    <div>
      <h2>Welcome, Premium User!</h2>
      <p>Active subscriptions: {subscriptions.length}</p>
      <button onClick={() => refetch()}>Refresh</button>
    </div>
  );
}
```

## See

 - [SolvaPayProvider](../variables/SolvaPayProvider.md) for required context provider
 - [useSubscriptionStatus](useSubscriptionStatus.md) for detailed status information

## Since

1.0.0
