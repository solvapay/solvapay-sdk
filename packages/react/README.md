# @solvapay/react

Headless React components and hooks for SolvaPay payment integration with Stripe.

## Install

```bash
pnpm add @solvapay/react
```

## Peer Dependencies

- `react` ^18.2.0 || ^19.0.0
- `react-dom` ^18.2.0 || ^19.0.0

## Quick Start

```tsx
import { SolvaPayProvider, UpgradeButton, useSubscription } from '@solvapay/react';

export default function App() {
  return (
    <SolvaPayProvider
      customerRef={user?.id}
      createPayment={async ({ planRef, customerRef }) => {
        const res = await fetch('/api/payments/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planRef, customerRef }),
        });
        if (!res.ok) throw new Error('Failed to create payment');
        return res.json();
      }}
      checkSubscription={async (customerRef) => {
        const res = await fetch(`/api/subscriptions/${customerRef}`);
        if (!res.ok) throw new Error('Failed to check subscription');
        return res.json();
      }}
    >
      <CheckoutPage />
    </SolvaPayProvider>
  );
}
```

## Components

### SolvaPayProvider

Headless context provider that manages subscription state and payment methods.

**Props:**
- `createPayment: (params: { planRef: string; customerRef: string }) => Promise<PaymentIntentResult>` - Function to create payment intent
- `checkSubscription: (customerRef: string) => Promise<CustomerSubscriptionData>` - Function to check subscription status
- `customerRef?: string` - Optional customer reference
- `onCustomerRefUpdate?: (newCustomerRef: string) => void` - Callback when customer ref updates
- `children: React.ReactNode` - Child components

### UpgradeButton

Headless component for handling upgrade flows with render props pattern.

**Props:**
- `planRef: string` - Plan reference to upgrade to
- `onSuccess?: () => void` - Callback on successful payment
- `onError?: (error: Error) => void` - Callback on payment error
- `children: (props) => React.ReactNode` - Render prop function
- `renderPaymentForm?: (props) => React.ReactNode` - Custom payment form renderer
- `paymentFormContainerClassName?: string` - Optional className for container
- `cancelButtonClassName?: string` - Optional className for cancel button

**Example:**
```tsx
<UpgradeButton planRef="pro_plan">
  {({ onClick, loading, disabled, error }) => (
    <button onClick={onClick} disabled={disabled}>
      {loading ? 'Processing...' : 'Upgrade to Pro'}
      {error && <span>Error: {error.message}</span>}
    </button>
  )}
</UpgradeButton>
```

### PaymentForm

Payment form component using Stripe PaymentElement. Must be wrapped in Stripe Elements provider (provided by UpgradeButton or manually).

**Props:**
- `onSuccess?: (paymentIntent: PaymentIntent) => void` - Callback on successful payment
- `onError?: (error: Error) => void` - Callback on payment error
- `returnUrl?: string` - Return URL after payment
- `submitButtonText?: string` - Submit button text (default: "Pay Now")
- `className?: string` - Form className (legacy, use formClassName)
- `formClassName?: string` - Form element className
- `messageClassName?: string` - Message container className
- `buttonClassName?: string` - Submit button className

### PlanBadge

Displays current subscription plan with render props or className pattern.

**Props:**
- `children?: (props) => React.ReactNode` - Render prop function
- `as?: React.ElementType` - Component to render (default: "div")
- `className?: string | ((props) => string)` - ClassName or function

**Example:**
```tsx
<PlanBadge className="badge badge-primary" />
```

### SubscriptionGate

Controls access to content based on subscription status.

**Props:**
- `requirePlan?: string` - Optional plan name to require
- `children: (props) => React.ReactNode` - Render prop function

**Example:**
```tsx
<SubscriptionGate requirePlan="Pro Plan">
  {({ hasAccess, loading, subscriptions }) => {
    if (loading) return <Loading />;
    if (!hasAccess) return <Paywall />;
    return <PremiumContent />;
  }}
</SubscriptionGate>
```

## Hooks

### useSubscription

Access subscription status and refetch function.

```tsx
const { subscriptions, loading, hasActiveSubscription, hasPlan, refetch } = useSubscription();
```

### useCheckout

Manage checkout flow for a specific plan.

```tsx
const { loading, error, startCheckout, reset } = useCheckout('plan_ref');
```

### useSolvaPay

Access SolvaPay context directly.

```tsx
const { subscription, createPayment, customerRef } = useSolvaPay();
```

## TypeScript

All components and hooks are fully typed. Import types as needed:

```tsx
import type { PaymentFormProps, SubscriptionStatus, PaymentIntentResult } from '@solvapay/react';
```

## More Information

See `docs/architecture.md` for detailed architecture documentation.
