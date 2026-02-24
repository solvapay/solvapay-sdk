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

### Zero-Config Usage (Recommended)

```tsx
import { SolvaPayProvider, PaymentForm, usePurchase } from '@solvapay/react'

export default function App() {
  return (
    <SolvaPayProvider>
      <CheckoutPage />
    </SolvaPayProvider>
  )
}
```

By default, `SolvaPayProvider` uses:

- `/api/check-purchase` for purchase checks
- `/api/create-payment-intent` for payment creation
- `/api/process-payment` for payment processing

### Custom API Routes

```tsx
import { SolvaPayProvider, PaymentForm } from '@solvapay/react'

export default function App() {
  return (
    <SolvaPayProvider
      config={{
        api: {
          checkPurchase: '/api/custom/purchase',
          createPayment: '/api/custom/payment',
          processPayment: '/api/custom/process',
        },
      }}
    >
      <CheckoutPage />
    </SolvaPayProvider>
  )
}
```

### With Supabase Authentication

```tsx
import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'

export default function App() {
  const adapter = createSupabaseAuthAdapter({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  })

  return (
    <SolvaPayProvider config={{ auth: { adapter } }}>
      <CheckoutPage />
    </SolvaPayProvider>
  )
}
```

### Fully Custom Implementation

```tsx
import { SolvaPayProvider } from '@solvapay/react'

export default function App() {
  return (
    <SolvaPayProvider
      createPayment={async ({ planRef, productRef }) => {
        const res = await fetch('/api/custom/payment', {
          method: 'POST',
          body: JSON.stringify({ planRef, productRef }),
        })
        if (!res.ok) throw new Error('Failed to create payment')
        return res.json()
      }}
      checkPurchase={async customerRef => {
        const res = await fetch(`/api/custom/purchase?customerRef=${customerRef}`)
        if (!res.ok) throw new Error('Failed to check purchase')
        return res.json()
      }}
    >
      <CheckoutPage />
    </SolvaPayProvider>
  )
}
```

## Components

### SolvaPayProvider

Headless context provider that manages purchase state, payment methods, and customer references.

**Features:**

- Zero-config with sensible defaults
- Auto-fetches purchases on mount
- Built-in localStorage caching with user validation
- Supports auth adapters for extracting user IDs and tokens
- Customizable API routes via config

**Props:**

- `config?: SolvaPayConfig` - Configuration object (optional)
  - `config.api?` - Custom API route paths
  - `config.auth?` - Auth adapter configuration
- `createPayment?: (params: { planRef: string; productRef?: string }) => Promise<PaymentIntentResult>` - Custom payment creation function (optional, overrides config)
- `checkPurchase?: (customerRef: string) => Promise<CustomerPurchaseData>` - Custom purchase check function (optional, overrides config)
- `processPayment?: (params: { paymentIntentId: string; productRef: string; planRef?: string }) => Promise<ProcessPaymentResult>` - Custom payment processing function (optional)
- `children: React.ReactNode` - Child components

**Config Options:**

```tsx
interface SolvaPayConfig {
  api?: {
    checkPurchase?: string // Default: '/api/check-purchase'
    createPayment?: string // Default: '/api/create-payment-intent'
    processPayment?: string // Default: '/api/process-payment'
  }
  auth?: {
    adapter?: AuthAdapter // Auth adapter for extracting user ID/token
    getToken?: () => Promise<string | null> // Deprecated: use adapter
    getUserId?: () => Promise<string | null> // Deprecated: use adapter
  }
}
```

### PlanSelector

Component for selecting and displaying available plans.

**Props:**

- `productRef?: string` - Product reference to filter plans
- `fetcher?: (productRef: string) => Promise<Plan[]>` - Custom plan fetcher function
- `onPlanSelect?: (plan: Plan) => void` - Callback when plan is selected
- `renderPlan?: (plan: Plan) => React.ReactNode` - Custom plan renderer
- `className?: string` - Container className

**Example:**

```tsx
import { PlanSelector, usePlans } from '@solvapay/react'

function PlansPage() {
  const { plans, loading } = usePlans({ productRef: 'my-product' })

  return (
    <div>
      {loading ? 'Loading...' : plans.map(plan => <div key={plan.reference}>{plan.name}</div>)}
    </div>
  )
}
```

### PaymentForm

Payment form component using Stripe PaymentElement. Automatically handles Stripe Elements provider setup.

**Props:**

- `planRef: string` - Plan reference for the payment
- `productRef?: string` - Optional product reference
- `onSuccess?: (paymentIntent: PaymentIntent) => void` - Callback on successful payment
- `onError?: (error: Error) => void` - Callback on payment error
- `returnUrl?: string` - Return URL after payment
- `submitButtonText?: string` - Submit button text (default: "Pay Now")
- `formClassName?: string` - Form element className
- `messageClassName?: string` - Message container className
- `buttonClassName?: string` - Submit button className

**Example:**

```tsx
import { PaymentForm } from '@solvapay/react'

function CheckoutPage() {
  return (
    <PaymentForm
      planRef="pln_YOUR_PLAN"
      productRef="prd_YOUR_PRODUCT"
      onSuccess={() => console.log('Payment successful!')}
    />
  )
}
```

### PlanBadge

Displays current purchase plan with render props or className pattern.

**Props:**

- `children?: (props) => React.ReactNode` - Render prop function
- `as?: React.ElementType` - Component to render (default: "div")
- `className?: string | ((props) => string)` - ClassName or function

**Example:**

```tsx
<PlanBadge className="badge badge-primary" />
```

### PurchaseGate

Controls access to content based on purchase status.

**Props:**

- `requirePlan?: string` - Optional plan name to require
- `children: (props) => React.ReactNode` - Render prop function

**Example:**

```tsx
<PurchaseGate requirePlan="Pro Plan">
  {({ hasAccess, loading, purchases }) => {
    if (loading) return <Loading />
    if (!hasAccess) return <Paywall />
    return <PremiumContent />
  }}
</PurchaseGate>
```

## Hooks

### usePurchase

Access purchase status, active purchases, and helper functions.

```tsx
const {
  purchases, // Array of all purchases
  loading, // Loading state
  hasPaidPurchase, // Boolean: has any paid purchase
  activePurchase, // Most recent active purchase
  refetch, // Function to refetch purchases
} = usePurchase()
```

### usePlans

Fetch and manage available plans.

```tsx
const {
  plans, // Array of available plans
  loading, // Loading state
  error, // Error object if fetch failed
  refetch, // Function to refetch plans
} = usePlans({
  productRef: 'my-product', // Optional product reference
  fetcher: customFetcher, // Optional custom fetcher function
})
```

### usePurchaseStatus

Advanced purchase status helpers.

```tsx
const {
  cancelledPurchase, // Most recent cancelled purchase
  shouldShowCancelledNotice, // Boolean: should show cancellation notice
  formatDate, // Helper to format dates
  getDaysUntilExpiration, // Helper to get days until expiration
} = usePurchaseStatus()
```

### useCheckout

Manage checkout flow for a specific plan.

```tsx
const { loading, error, startCheckout, reset } = useCheckout('plan_ref')
```

### useSolvaPay

Access SolvaPay context directly.

```tsx
const {
  purchaseData, // Full purchase data
  loading, // Loading state
  createPayment, // Payment creation function
  processPayment, // Payment processing function
  customerRef, // Current customer reference
  updateCustomerRef, // Function to update customer reference
} = useSolvaPay()
```

## TypeScript

All components and hooks are fully typed. Import types as needed:

```tsx
import type { PaymentFormProps, PurchaseStatus, PaymentIntentResult } from '@solvapay/react'
```

## More Information

See [`docs/guides/architecture.md`](../../docs/guides/architecture.md) for detailed architecture documentation.
