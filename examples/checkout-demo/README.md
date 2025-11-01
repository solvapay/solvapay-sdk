# SolvaPay Checkout Demo - Headless Components

Complete payment integration demo showcasing SolvaPay's headless React components with locked content and subscription gates.

## Features

- 🎯 **Headless Components**: Fully flexible, unstyled components with render props
- 🔒 **Content Gating**: Lock premium features behind subscriptions
- 💳 **Secure Payments**: Stripe-powered payment processing
- 📊 **Subscription Management**: Real-time subscription status checking
- 🎨 **Style Agnostic**: Works with any CSS framework or design system
- 🧪 **Test Mode**: Complete test environment with localStorage persistence

## New Headless Architecture

This demo showcases the modern headless component approach:

### Core Components

1. **`<SolvaPayProvider>`** - Context provider with subscription state
2. **`<SubscriptionGate>`** - Conditional rendering based on subscription
3. **`<UpgradeButton>`** - Complete upgrade flow with inline payment
4. **`<PlanBadge>`** - Display current subscription status
5. **`useSubscription`** - Hook for subscription state access
6. **`useCheckout`** - Hook for checkout flow management

## Prerequisites

Before running this demo, you need:

1. **SolvaPay Account**
   - Sign up at https://solvapay.com
   - Get your secret API key from the dashboard
   - Create at least one agent and plan

2. **Environment Variables**
   - Copy `env.example` to `.env.local`
   - Fill in your SolvaPay credentials

## Setup

```bash
# Install dependencies (from workspace root)
pnpm install

# Navigate to the demo
cd examples/checkout-demo

# Copy environment variables
cp env.example .env.local

# Edit .env.local with your SolvaPay credentials
# Required: SOLVAPAY_SECRET_KEY
# Optional: SOLVAPAY_API_BASE_URL, NEXT_PUBLIC_AGENT_REF, plan references
```

## Running the Demo

```bash
# Development mode
pnpm dev

# Production build
pnpm build
pnpm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Demo Flow

1. **Home Page**: View locked premium content
2. **Click Upgrade**: Trigger inline payment form
3. **Complete Payment**: Use test card (4242 4242 4242 4242)
4. **View Unlocked Content**: Premium features are instantly available
5. **Persistence**: Subscription persists in localStorage across refreshes

## Testing Payments

Use these test card numbers in the checkout form:

| Card Number | Result |
|------------|--------|
| 4242 4242 4242 4242 | ✅ Payment succeeds |
| 4000 0000 0000 0002 | ❌ Payment declined |
| 4000 0000 0000 9995 | ❌ Insufficient funds |

- Use any future expiry date
- Use any 3-digit CVC
- Use any billing ZIP code

## How It Works

### 1. Root Provider Setup

```tsx
// app/layout.tsx
import { SolvaPayProvider } from '@solvapay/react';

<SolvaPayProvider
  customerRef={customerId}
  createPayment={async ({ planRef, customerRef }) => {
    const res = await fetch('/api/create-payment-intent', {
      method: 'POST',
      body: JSON.stringify({ planRef, customerRef, agentRef })
    });
    return res.json();
  }}
  checkSubscription={async (customerRef) => {
    const res = await fetch(`/api/check-subscription?customerRef=${customerRef}`);
    return res.json();
  }}
>
  {children}
</SolvaPayProvider>
```

### 2. Locked Content with SubscriptionGate

```tsx
// app/page.tsx
import { SubscriptionGate, UpgradeButton } from '@solvapay/react';

<SubscriptionGate requirePlan="Pro Plan">
  {({ hasAccess, loading }) => {
    if (loading) return <Skeleton />;
    
    if (!hasAccess) {
      return (
        <div>
          <h2>🔒 Premium Content</h2>
          <UpgradeButton planRef="pln_pro">
            {({ onClick, loading }) => (
              <button onClick={onClick}>
                {loading ? 'Loading...' : 'Upgrade Now'}
              </button>
            )}
          </UpgradeButton>
        </div>
      );
    }
    
    return <PremiumContent />;
  }}
</SubscriptionGate>
```

### 3. Navigation with Plan Badge

```tsx
// app/components/Navigation.tsx
import { PlanBadge, UpgradeButton } from '@solvapay/react';

<PlanBadge>
  {({ subscriptions, loading }) => {
    const activeSubs = subscriptions.filter(sub => sub.status === 'active');
    return (
      <div>
        {activeSubs.length > 0 
          ? activeSubs.map(sub => <span>✓ {sub.planName}</span>)
          : <span>Free Plan</span>
        }
      </div>
    );
  }}
</PlanBadge>

<UpgradeButton planRef="pln_pro">
  {({ onClick, loading, disabled }) => (
    <button onClick={onClick} disabled={disabled}>
      {loading ? 'Processing...' : 'Upgrade'}
    </button>
  )}
</UpgradeButton>
```

### 4. Backend API Routes

**Check Subscription:**
```typescript
// app/api/check-subscription/route.ts
import { createSolvaPay } from '@solvapay/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerRef = searchParams.get('customerRef');
  
  const solvapay = createSolvaPay({
    apiKey: process.env.SOLVAPAY_SECRET_KEY
  });
  
  const customer = await solvapay.getCustomer({ customerRef });
  
  return NextResponse.json({
    customerRef: customer.customerRef,
    email: customer.email,
    name: customer.name,
    subscriptions: customer.subscriptions || []
  });
}
```

**Create Payment Intent:**
```typescript
// app/api/create-payment-intent/route.ts
const { planRef, agentRef, customerRef } = await request.json();

const solvapay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY
});

await solvapay.ensureCustomer(customerRef);

const paymentIntent = await solvapay.createPaymentIntent({
  agentRef,
  planRef,
  customerRef
});

return NextResponse.json({
  clientSecret: paymentIntent.clientSecret,
  publishableKey: paymentIntent.publishableKey,
  accountId: paymentIntent.accountId
});
```

## Project Structure

```
checkout-demo/
├── app/
│   ├── api/
│   │   ├── create-payment-intent/
│   │   │   └── route.ts          # Payment intent creation
│   │   └── check-subscription/
│   │       └── route.ts          # Subscription status check
│   ├── components/
│   │   └── Navigation.tsx        # Nav with PlanBadge and UpgradeButton
│   ├── lib/
│   │   └── customer.ts           # Customer ID management (localStorage)
│   ├── checkout/
│   │   └── page.tsx              # Checkout page with plan selection
│   ├── layout.tsx                # Root layout with SolvaPayProvider
│   └── page.tsx                  # Home with locked content
├── package.json
├── next.config.mjs
├── tsconfig.json
├── env.example
└── README.md
```

## Key Concepts

### Headless Components

All components use **render props** pattern for maximum flexibility:

```tsx
<Component>
  {({ state, handlers }) => (
    // Your custom UI here
  )}
</Component>
```

This allows you to:
- Use any CSS framework (Tailwind, CSS Modules, Styled Components)
- Implement any UI design
- Control all behavior and state
- Maintain full TypeScript type safety

### Subscription State Management

The provider automatically:
- Fetches subscription on mount
- Provides refetch method for updates
- Exposes helper methods (`hasActiveSubscription`, `hasPlan`)
- Manages loading states

### Customer Simulation

For demo purposes, customer IDs are stored in localStorage:
- Generated on first visit
- Persists across refreshes
- Simulates authenticated user state
- Replace with real auth in production

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SOLVAPAY_SECRET_KEY` | Your SolvaPay secret key | Yes |
| `SOLVAPAY_API_BASE_URL` | Backend URL (defaults to prod) | No |
| `NEXT_PUBLIC_AGENT_REF` | Agent reference | No |
| `NEXT_PUBLIC_BASIC_PLAN_REF` | Basic plan reference | No |
| `NEXT_PUBLIC_PRO_PLAN_REF` | Pro plan reference | No |

## Customization

### Adding New Plans

Edit `app/checkout/page.tsx`:

```typescript
const plans = {
  basic: {
    name: 'Basic Plan',
    amount: 999,  // $9.99 in cents
    planRef: 'pln_basic',
    features: ['Feature 1', 'Feature 2'],
  },
  enterprise: {
    name: 'Enterprise',
    amount: 9999,  // $99.99 in cents
    planRef: 'pln_enterprise',
    features: ['All features', 'Priority support'],
  },
};
```

### Custom Styling

All components accept any styling approach:

```tsx
// Tailwind
<UpgradeButton planRef="pro">
  {({ onClick, loading }) => (
    <button 
      onClick={onClick}
      className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
    >
      {loading ? 'Processing...' : 'Upgrade'}
    </button>
  )}
</UpgradeButton>

// CSS Modules
<PlanBadge>
  {({ subscriptions }) => (
    <div className={styles.badge}>
      {subscriptions.map(sub => sub.planName).join(', ')}
    </div>
  )}
</PlanBadge>
```

### Custom Payment Form

```tsx
<UpgradeButton
  planRef="pro"
  renderPaymentForm={({ onSuccess, onCancel }) => (
    <Modal open onClose={onCancel}>
      <h2>Complete Payment</h2>
      <PaymentForm onSuccess={onSuccess} />
      <button onClick={onCancel}>Cancel</button>
    </Modal>
  )}
>
  {({ onClick }) => <button onClick={onClick}>Upgrade</button>}
</UpgradeButton>
```

## Troubleshooting

### "Missing SOLVAPAY_SECRET_KEY"
- Ensure `.env.local` exists with your secret key
- Restart the dev server after adding environment variables

### "Payment intent creation failed"
- Check your SolvaPay API key is valid
- Verify the backend URL is correct
- Check network tab for API errors

### Subscription not updating after payment
- Check that `refetch()` is called after successful payment
- Verify API returns proper subscription format
- Check browser console for errors

### Components not rendering
- Ensure you're inside `<SolvaPayProvider>`
- Check that hooks are called in functional components
- Verify all required props are provided

## Learn More

- [SolvaPay Documentation](https://docs.solvapay.com)
- [Headless Components Pattern](https://www.patterns.dev/posts/headless-ui)
- [Stripe Testing Documentation](https://stripe.com/docs/testing)
- [Next.js Documentation](https://nextjs.org/docs)

## Support

For issues or questions:
- GitHub Issues: https://github.com/solvapay/solvapay-sdk/issues
- Documentation: https://docs.solvapay.com
- Email: support@solvapay.com
