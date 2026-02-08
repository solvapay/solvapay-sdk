# React Integration Guide

This guide shows you how to integrate SolvaPay React components and hooks into your React application to build payment flows and purchase management UIs.

## Table of Contents

- [Installation](#installation)
- [Basic Setup](#basic-setup)
- [Provider Configuration](#provider-configuration)
- [Components](#components)
- [Hooks](#hooks)
- [Payment Flow](#payment-flow)
- [Purchase Management](#purchase-management)
- [Complete Example](#complete-example)

## Installation

Install the required packages:

```bash
npm install @solvapay/react @solvapay/react-supabase
# or
pnpm add @solvapay/react @solvapay/react-supabase
# or
yarn add @solvapay/react @solvapay/react-supabase
```

### Peer Dependencies

SolvaPay React requires:

- `react` ^18.2.0 || ^19.0.0
- `react-dom` ^18.2.0 || ^19.0.0
- `@stripe/react-stripe-js` (for payment forms)
- `@stripe/stripe-js` (for Stripe integration)

## Basic Setup

### 1. Wrap Your App with Provider

The `SolvaPayProvider` is required to use SolvaPay hooks and components:

```tsx
// App.tsx or main entry point
import { SolvaPayProvider } from '@solvapay/react'

function App() {
  return (
    <SolvaPayProvider>
      <YourApp />
    </SolvaPayProvider>
  )
}
```

### 2. Zero-Config Usage

By default, `SolvaPayProvider` uses these API endpoints:

- `/api/check-purchase` - Check purchase status
- `/api/create-payment-intent` - Create payment intents
- `/api/process-payment` - Process payments

If your backend uses these routes, no configuration is needed!

## Provider Configuration

### Custom API Routes

If your backend uses different API routes, configure them:

```tsx
import { SolvaPayProvider } from '@solvapay/react'

function App() {
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
      <YourApp />
    </SolvaPayProvider>
  )
}
```

### With Supabase Authentication

Use the Supabase auth adapter for automatic user ID extraction:

```tsx
import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'

function App() {
  const supabaseAdapter = createSupabaseAuthAdapter({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  })

  return (
    <SolvaPayProvider
      config={{
        auth: { adapter: supabaseAdapter },
      }}
    >
      <YourApp />
    </SolvaPayProvider>
  )
}
```

### Custom Authentication Adapter

Create a custom auth adapter for other authentication systems:

```tsx
import { SolvaPayProvider, AuthAdapter } from '@solvapay/react'

const customAuthAdapter: AuthAdapter = {
  getUserId: async () => {
    // Extract user ID from your auth system
    const token = localStorage.getItem('auth-token')
    if (!token) return null

    const decoded = JSON.parse(atob(token.split('.')[1]))
    return decoded.userId
  },

  getUserEmail: async () => {
    // Extract email if available
    return null
  },

  getUserName: async () => {
    // Extract name if available
    return null
  },
}

function App() {
  return (
    <SolvaPayProvider
      config={{
        auth: { adapter: customAuthAdapter },
      }}
    >
      <YourApp />
    </SolvaPayProvider>
  )
}
```

## Components

### PaymentForm

A complete payment form component with Stripe integration:

```tsx
import { PaymentForm } from '@solvapay/react'

function CheckoutPage() {
  return (
    <PaymentForm
      planRef="pln_premium"
      agentRef="agt_myapi"
      onSuccess={() => {
        console.log('Payment successful!')
        // Redirect or show success message
      }}
      onError={error => {
        console.error('Payment failed:', error)
      }}
    />
  )
}
```

#### PaymentForm Props

- `planRef` (required) - Plan reference to purchase
- `agentRef` (required) - Agent reference for usage tracking
- `onSuccess` - Callback when payment succeeds
- `onError` - Callback when payment fails
- `returnUrl` - Optional return URL after payment
- `submitButtonText` - Custom submit button text (default: "Pay Now")
- `className` - Custom CSS class for form container
- `buttonClassName` - Custom CSS class for submit button

### PlanSelector

Select a plan from available plans:

```tsx
import { PlanSelector } from '@solvapay/react'

function PlanSelectionPage() {
  return (
    <PlanSelector
      agentRef="agt_myapi"
      onSelect={plan => {
        console.log('Selected plan:', plan)
        // Navigate to checkout with selected plan
      }}
    />
  )
}
```

### PurchaseGate

Conditionally render content based on purchase status:

```tsx
import { PurchaseGate } from '@solvapay/react'

function PremiumContent() {
  return (
    <PurchaseGate
      planRef="pln_premium"
      fallback={<div>Please purchase a plan to access this content.</div>}
    >
      <div>Premium content here!</div>
    </PurchaseGate>
  )
}
```

### PlanBadge

Display plan information:

```tsx
import { PlanBadge } from '@solvapay/react'

function UserProfile() {
  return (
    <div>
      <h1>Your Profile</h1>
      <PlanBadge planRef="pln_premium" />
    </div>
  )
}
```

## Hooks

### usePurchase

Check purchase status and access purchase data:

```tsx
import { usePurchase } from '@solvapay/react'

function Dashboard() {
  const { hasPaidPurchase, isLoading, purchase, refetch } = usePurchase()

  if (isLoading) {
    return <div>Loading purchase status...</div>
  }

  return (
    <div>
      {hasPaidPurchase ? (
        <div>
          <h2>Active Purchase</h2>
          <p>Plan: {purchase?.plan?.name}</p>
          <p>Status: {purchase?.status}</p>
        </div>
      ) : (
        <div>
          <p>No active purchase</p>
          <button onClick={() => refetch()}>Refresh</button>
        </div>
      )}
    </div>
  )
}
```

#### usePurchase Return Values

- `hasPaidPurchase` - Boolean indicating if user has paid purchase
- `isLoading` - Boolean indicating if purchase check is in progress
- `purchase` - Purchase data object (null if no purchase)
- `refetch` - Function to manually refetch purchase status
- `error` - Error object if purchase check failed

### useCheckout

Programmatic checkout flow:

```tsx
import { useCheckout } from '@solvapay/react'

function CustomCheckout() {
  const { createPayment, processPayment, isLoading, error } = useCheckout(
    'pln_premium',
    'agt_myapi',
  )

  const handleCheckout = async () => {
    try {
      // Create payment intent
      const intent = await createPayment()

      // Process payment (after Stripe confirmation)
      const result = await processPayment(intent.paymentIntentId)

      if (result.success) {
        console.log('Payment successful!')
      }
    } catch (error) {
      console.error('Checkout failed:', error)
    }
  }

  return (
    <button onClick={handleCheckout} disabled={isLoading}>
      {isLoading ? 'Processing...' : 'Checkout'}
    </button>
  )
}
```

### useCustomer

Access customer information:

```tsx
import { useCustomer } from '@solvapay/react'

function CustomerInfo() {
  const { customer, isLoading, refetch } = useCustomer()

  if (isLoading) {
    return <div>Loading customer info...</div>
  }

  return (
    <div>
      <h2>Customer Information</h2>
      <p>Customer ID: {customer?.id}</p>
      <p>Email: {customer?.email}</p>
    </div>
  )
}
```

### usePlans

Fetch available plans:

```tsx
import { usePlans } from '@solvapay/react'

function PlansPage() {
  const { plans, isLoading, error } = usePlans({
    agentRef: 'agt_myapi',
  })

  if (isLoading) {
    return <div>Loading plans...</div>
  }

  if (error) {
    return <div>Error loading plans: {error.message}</div>
  }

  return (
    <div>
      <h1>Available Plans</h1>
      {plans?.map(plan => (
        <div key={plan.id}>
          <h3>{plan.name}</h3>
          <p>{plan.description}</p>
          <p>Price: ${plan.price}</p>
        </div>
      ))}
    </div>
  )
}
```

### useSolvaPay

Access all SolvaPay functionality:

```tsx
import { useSolvaPay } from '@solvapay/react'

function CustomComponent() {
  const { purchase, createPayment, processPayment, customerRef, refetchPurchase } =
    useSolvaPay()

  // Use any SolvaPay functionality
  return <div>...</div>
}
```

## Payment Flow

### Simple Payment Flow

Use `PaymentForm` for a complete payment flow:

```tsx
import { PaymentForm } from '@solvapay/react'
import { useRouter } from 'next/navigation' // or your router

function CheckoutPage() {
  const router = useRouter()

  return (
    <div className="checkout-container">
      <h1>Get Premium</h1>
      <PaymentForm
        planRef="pln_premium"
        agentRef="agt_myapi"
        onSuccess={() => {
          router.push('/dashboard')
        }}
        onError={error => {
          alert(`Payment failed: ${error.message}`)
        }}
      />
    </div>
  )
}
```

### Custom Payment Flow

Build a custom payment flow with hooks:

```tsx
import { useCheckout, usePurchase } from '@solvapay/react'
import { loadStripe } from '@stripe/stripe-js'

function CustomCheckoutPage() {
  const { createPayment, processPayment, isLoading } = useCheckout('pln_premium', 'agt_myapi')
  const { refetch } = usePurchase()
  const [stripe, setStripe] = useState(null)

  useEffect(() => {
    // Initialize Stripe
    loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!).then(setStripe)
  }, [])

  const handleCheckout = async () => {
    try {
      // Create payment intent
      const intent = await createPayment()

      // Confirm payment with Stripe
      const { error: stripeError } = await stripe.confirmCardPayment(intent.clientSecret, {
        payment_method: {
          card: cardElement,
        },
      })

      if (stripeError) {
        throw stripeError
      }

      // Process payment
      const result = await processPayment(intent.paymentIntentId)

      if (result.success) {
        await refetch() // Refresh purchase status
        router.push('/dashboard')
      }
    } catch (error) {
      console.error('Checkout failed:', error)
    }
  }

  return (
    <div>
      {/* Your custom UI */}
      <button onClick={handleCheckout} disabled={isLoading}>
        Pay Now
      </button>
    </div>
  )
}
```

## Purchase Management

### Check Purchase Status

```tsx
import { usePurchase } from '@solvapay/react'

function ProtectedContent() {
  const { hasPaidPurchase, isLoading } = usePurchase()

  if (isLoading) {
    return <div>Loading...</div>
  }

  if (!hasPaidPurchase) {
    return <div>Please purchase a plan to access this content.</div>
  }

  return <div>Premium content here!</div>
}
```

### Display Purchase Details

```tsx
import { usePurchase } from '@solvapay/react'

function PurchaseDetails() {
  const { purchase, isLoading } = usePurchase()

  if (isLoading) {
    return <div>Loading...</div>
  }

  if (!purchase) {
    return <div>No active purchase</div>
  }

  return (
    <div>
      <h2>Your Purchase</h2>
      <p>Plan: {purchase.plan?.name}</p>
      <p>Status: {purchase.status}</p>
      <p>Current Period End: {purchase.currentPeriodEnd}</p>
    </div>
  )
}
```

### Refresh Purchase Status

```tsx
import { usePurchase } from '@solvapay/react'

function PurchaseStatus() {
  const { purchase, refetch, isLoading } = usePurchase()

  return (
    <div>
      <p>Status: {purchase?.status || 'None'}</p>
      <button onClick={() => refetch()} disabled={isLoading}>
        Refresh
      </button>
    </div>
  )
}
```

## Complete Example

Here's a complete React application with SolvaPay integration:

```tsx
// App.tsx
import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { Dashboard } from './Dashboard'
import { Checkout } from './Checkout'

function App() {
  const supabaseAdapter = createSupabaseAuthAdapter({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  })

  return (
    <SolvaPayProvider config={{ auth: { adapter: supabaseAdapter } }}>
      <Router>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/checkout" element={<Checkout />} />
        </Routes>
      </Router>
    </SolvaPayProvider>
  )
}

// Dashboard.tsx
import { usePurchase } from '@solvapay/react'
import { Link } from 'react-router-dom'

export function Dashboard() {
  const { hasPaidPurchase, isLoading, purchase } = usePurchase()

  if (isLoading) {
    return <div>Loading...</div>
  }

  return (
    <div>
      <h1>Dashboard</h1>

      {hasPaidPurchase ? (
        <div>
          <h2>Welcome, Premium User!</h2>
          <p>Plan: {purchase?.plan?.name}</p>
          <p>Status: {purchase?.status}</p>
        </div>
      ) : (
        <div>
          <p>Please purchase a plan to access premium features.</p>
          <Link to="/checkout">Go to Checkout</Link>
        </div>
      )}
    </div>
  )
}

// Checkout.tsx
import { PaymentForm } from '@solvapay/react'
import { useNavigate } from 'react-router-dom'

export function Checkout() {
  const navigate = useNavigate()

  return (
    <div>
      <h1>Get Premium</h1>
      <PaymentForm
        planRef="pln_premium"
        agentRef="agt_myapi"
        onSuccess={() => {
          navigate('/dashboard')
        }}
        onError={error => {
          console.error('Payment failed:', error)
        }}
      />
    </div>
  )
}
```

## Styling

SolvaPay components are headless and don't include default styles. Style them to match your design system:

```tsx
<PaymentForm
  planRef="pln_premium"
  agentRef="agt_myapi"
  className="my-custom-form"
  buttonClassName="my-custom-button"
/>
```

```css
.my-custom-form {
  max-width: 500px;
  margin: 0 auto;
  padding: 2rem;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
}

.my-custom-button {
  background-color: #007bff;
  color: white;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
```

## Best Practices

1. **Provider Placement**: Place `SolvaPayProvider` at the root of your app, above all routes.

2. **Error Handling**: Always handle errors from hooks and components.

3. **Loading States**: Show loading states while purchase checks are in progress.

4. **Refetch After Payment**: Call `refetch()` after successful payment to update purchase status.

5. **Type Safety**: Use TypeScript for better type safety and autocomplete.

6. **Custom Styling**: Style components to match your design system.

## Next Steps

- [Next.js Integration Guide](./nextjs.md) - Learn Next.js-specific integration
- [Custom Authentication Adapters](./custom-auth.md) - Build custom auth adapters
- [Error Handling Strategies](./error-handling.md) - Advanced error handling
- [API Reference](../api/react/src/README.md) - Full API documentation
