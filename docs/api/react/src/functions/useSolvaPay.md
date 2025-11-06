[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / useSolvaPay

# Function: useSolvaPay()

> **useSolvaPay**(): [`SolvaPayContextValue`](../interfaces/SolvaPayContextValue.md)

Defined in: [packages/react/src/hooks/useSolvaPay.ts:46](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/hooks/useSolvaPay.ts#L46)

Hook to access SolvaPay context and provider methods.

This is the base hook that provides access to all SolvaPay functionality
including subscription data, payment methods, and customer information.
Other hooks like `useSubscription` and `useCheckout` use this internally.

Must be used within a `SolvaPayProvider` component.

## Returns

[`SolvaPayContextValue`](../interfaces/SolvaPayContextValue.md)

SolvaPay context value with all provider methods and state

## Example

```tsx
import { useSolvaPay } from '@solvapay/react';

function CustomComponent() {
  const { subscription, createPayment, processPayment } = useSolvaPay();

  const handlePayment = async () => {
    const intent = await createPayment({
      planRef: 'pln_premium',
      agentRef: 'agt_myapi'
    });
    // Process payment...
  };

  return <div>Subscription status: {subscription.hasPaidSubscription ? 'Active' : 'None'}</div>;
}
```

## Throws

If used outside of SolvaPayProvider

## See

 - [SolvaPayProvider](../variables/SolvaPayProvider.md) for required context provider
 - [useSubscription](useSubscription.md) for subscription-specific hook
 - [useCheckout](useCheckout.md) for checkout-specific hook

## Since

1.0.0
