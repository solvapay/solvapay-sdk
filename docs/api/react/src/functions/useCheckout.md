[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / useCheckout

# Function: useCheckout()

> **useCheckout**(`planRef`, `agentRef?`): `UseCheckoutReturn`

Defined in: [packages/react/src/hooks/useCheckout.ts:70](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/hooks/useCheckout.ts#L70)

Hook to manage checkout flow for payment processing.

Handles payment intent creation and Stripe initialization. This hook
manages the checkout state including loading, errors, Stripe instance,
and client secret. Use this for programmatic checkout flows.

## Parameters

### planRef

`string`

Plan reference to subscribe to (required)

### agentRef?

`string`

Optional agent reference for usage tracking

## Returns

`UseCheckoutReturn`

Checkout state and methods

## Example

```tsx
import { useCheckout } from '@solvapay/react';
import { PaymentElement } from '@stripe/react-stripe-js';

function CustomCheckout() {
  const { loading, error, stripePromise, clientSecret, startCheckout } = useCheckout(
    'pln_premium',
    'agt_myapi'
  );

  useEffect(() => {
    startCheckout();
  }, []);

  if (loading) return <Spinner />;
  if (error) return <div>Error: {error.message}</div>;
  if (!clientSecret || !stripePromise) return null;

  return (
    <Elements stripe={await stripePromise} options={{ clientSecret }}>
      <PaymentElement />
    </Elements>
  );
}
```

## See

 - [PaymentForm](../variables/PaymentForm.md) for a complete payment form component
 - [SolvaPayProvider](../variables/SolvaPayProvider.md) for required context provider

## Since

1.0.0
