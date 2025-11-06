[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / PaymentForm

# Variable: PaymentForm

> `const` **PaymentForm**: `React.FC`\<[`PaymentFormProps`](../interfaces/PaymentFormProps.md)\>

Defined in: [packages/react/src/PaymentForm.tsx:64](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/PaymentForm.tsx#L64)

Payment form component for handling Stripe checkout.

This component provides a complete payment form with Stripe integration,
including card input, plan selection, and payment processing. It handles
the entire checkout flow including payment intent creation and confirmation.

Features:
- Automatic Stripe Elements initialization
- Payment intent creation on mount
- Card input and validation
- Payment processing with error handling
- Automatic subscription refresh after payment

## Param

Payment form configuration

## Param

Plan reference to subscribe to (required)

## Param

Agent reference for usage tracking (required)

## Param

Callback when payment succeeds

## Param

Callback when payment fails

## Param

Optional return URL after payment (for redirects)

## Param

Custom text for submit button (default: 'Pay Now')

## Param

Custom CSS class for the form container

## Param

Custom CSS class for the submit button

## Example

```tsx
import { PaymentForm } from '@solvapay/react';
import { useRouter } from 'next/navigation';

function CheckoutPage() {
  const router = useRouter();

  return (
    <PaymentForm
      planRef="pln_premium"
      agentRef="agt_myapi"
      onSuccess={() => {
        console.log('Payment successful!');
        router.push('/dashboard');
      }}
      onError={(error) => {
        console.error('Payment failed:', error);
      }}
    />
  );
}
```

## See

 - [useCheckout](../functions/useCheckout.md) for programmatic checkout handling
 - [SolvaPayProvider](SolvaPayProvider.md) for required context provider

## Since

1.0.0
