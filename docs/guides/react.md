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
  getToken: async () => {
    // Return auth token from your auth system
    return localStorage.getItem('auth-token')
  },

  getUserId: async () => {
    // Extract user ID from your auth system
    const token = localStorage.getItem('auth-token')
    if (!token) return null

    const decoded = JSON.parse(atob(token.split('.')[1]))
    return decoded.userId
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
      productRef="prd_myapi"
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

- `planRef` (required) - Plan reference to subscribe to
- `productRef` (optional) - Product reference for usage tracking
- `onSuccess` - Callback when payment succeeds
- `onError` - Callback when payment fails
- `returnUrl` - Optional return URL after payment
- `submitButtonText` - Custom submit button text (default: "Pay Now")
- `className` - Custom CSS class for form container
- `buttonClassName` - Custom CSS class for submit button

### PlanSelector

Select a plan from available plans using the render-prop API:

```tsx
import { PlanSelector } from '@solvapay/react'

function PlanSelectionPage() {
  return (
    <PlanSelector
      fetcher={async (productRef) => {
        const res = await fetch(`/api/plans?productRef=${productRef}`)
        return res.json()
      }}
      productRef="prd_myapi"
    >
      {({ plans, loading, error, selectedPlan, selectPlan }) => {
        if (loading) return <div>Loading plans...</div>
        if (error) return <div>Error: {error.message}</div>
        return (
          <div>
            {plans.map(plan => (
              <button
                key={plan.id}
                onClick={() => selectPlan(plan)}
                style={{ fontWeight: selectedPlan?.id === plan.id ? 'bold' : 'normal' }}
              >
                {plan.name} - ${plan.price}
              </button>
            ))}
          </div>
        )
      }}
    </PlanSelector>
  )
}
```

### PurchaseGate

Conditionally render content based on purchase status using the render-prop pattern:

```tsx
import { PurchaseGate } from '@solvapay/react'

function PremiumContent() {
  return (
    <PurchaseGate requirePlan="pln_premium">
      {({ hasAccess, loading }) => {
        if (loading) return <div>Loading...</div>
        if (!hasAccess) return <div>Please subscribe to access this content.</div>
        return <div>Premium content here!</div>
      }}
    </PurchaseGate>
  )
}
```

### PlanBadge

Display plan information using the render-prop pattern:

```tsx
import { PlanBadge } from '@solvapay/react'

function UserProfile() {
  return (
    <div>
      <h1>Your Profile</h1>
      <PlanBadge>
        {({ displayPlan, shouldShow }) =>
          shouldShow ? <span className="badge">{displayPlan}</span> : null
        }
      </PlanBadge>
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
  const { hasPaidPurchase, loading, activePurchase, refetch } = usePurchase()

  if (loading) {
    return <div>Loading purchase status...</div>
  }

  return (
    <div>
      {hasPaidPurchase ? (
        <div>
          <h2>Active Purchase</h2>
          <p>Plan: {activePurchase?.planName}</p>
          <p>Status: {activePurchase?.status}</p>
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

- `loading` - Boolean indicating if purchase check is in progress
- `purchases` - Array of purchase objects
- `activePurchase` - The active purchase (or null)
- `hasPaidPurchase` - Boolean indicating if user has paid purchase
- `activePaidPurchase` - The active paid purchase (or null)
- `hasPlan(planName)` - Function to check if user has a specific plan
- `refetch` - Function to manually refetch purchase status

### useCheckout

Programmatic checkout flow:

```tsx
import { useCheckout } from '@solvapay/react'

function CustomCheckout() {
  const { startCheckout, loading, error, stripePromise, clientSecret, reset } = useCheckout(
    'pln_premium',
    'prd_myapi',
  )

  const handleCheckout = async () => {
    try {
      await startCheckout()
      console.log('Checkout started!')
    } catch (error) {
      console.error('Checkout failed:', error)
    }
  }

  return (
    <button onClick={handleCheckout} disabled={loading}>
      {loading ? 'Processing...' : 'Checkout'}
    </button>
  )
}
```

### useCustomer

Access customer information:

```tsx
import { useCustomer } from '@solvapay/react'

function CustomerInfo() {
  const { customerRef, email, name, loading } = useCustomer()

  if (loading) {
    return <div>Loading customer info...</div>
  }

  return (
    <div>
      <h2>Customer Information</h2>
      <p>Customer ID: {customerRef}</p>
      <p>Email: {email}</p>
      <p>Name: {name}</p>
    </div>
  )
}
```

### usePlans

Fetch available plans:

```tsx
import { usePlans } from '@solvapay/react'

function PlansPage() {
  const { plans, loading, error } = usePlans({
    fetcher: async (productRef) => {
      const res = await fetch(`/api/plans?productRef=${productRef}`)
      return res.json()
    },
    productRef: 'prd_myapi',
  })

  if (loading) {
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
  const { activePurchase, startCheckout, customerRef, refetchPurchase } =
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
      <h1>Subscribe to Premium</h1>
      <PaymentForm
        planRef="pln_premium"
        productRef="prd_myapi"
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
  const { startCheckout, loading, stripePromise, clientSecret, reset } = useCheckout('pln_premium', 'prd_myapi')
  const { refetch } = usePurchase()

  const handleCheckout = async () => {
    try {
      await startCheckout()

      // After successful checkout, refresh purchase status
      await refetch()
      router.push('/dashboard')
    } catch (error) {
      console.error('Checkout failed:', error)
    }
  }

  return (
    <div>
      {/* Your custom UI */}
      <button onClick={handleCheckout} disabled={loading}>
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
  const { hasPaidPurchase, loading } = usePurchase()

  if (loading) {
    return <div>Loading...</div>
  }

  if (!hasPaidPurchase) {
    return <div>Please subscribe to access this content.</div>
  }

  return <div>Premium content here!</div>
}
```

### Display Purchase Details

```tsx
import { usePurchase } from '@solvapay/react'

function PurchaseDetails() {
  const { activePurchase, loading } = usePurchase()

  if (loading) {
    return <div>Loading...</div>
  }

  if (!activePurchase) {
    return <div>No active purchase</div>
  }

  return (
    <div>
      <h2>Your Purchase</h2>
      <p>Plan: {activePurchase.planName}</p>
      <p>Status: {activePurchase.status}</p>
      <p>Current Period End: {activePurchase.currentPeriodEnd}</p>
    </div>
  )
}
```

### Refresh Purchase Status

```tsx
import { usePurchase } from '@solvapay/react'

function PurchaseStatus() {
  const { activePurchase, refetch, loading } = usePurchase()

  return (
    <div>
      <p>Status: {activePurchase?.status || 'None'}</p>
      <button onClick={() => refetch()} disabled={loading}>
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
  const { hasPaidPurchase, loading, activePurchase } = usePurchase()

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <div>
      <h1>Dashboard</h1>

      {hasPaidPurchase ? (
        <div>
          <h2>Welcome, Premium User!</h2>
          <p>Plan: {activePurchase?.planName}</p>
          <p>Status: {activePurchase?.status}</p>
        </div>
      ) : (
        <div>
          <p>Please subscribe to access premium features.</p>
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
      <h1>Subscribe to Premium</h1>
      <PaymentForm
        planRef="pln_premium"
        productRef="prd_myapi"
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
  productRef="prd_myapi"
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
- [API Reference](../../packages/react/README.md) - Full API documentation
