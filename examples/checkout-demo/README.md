# SolvaPay Checkout Demo - Headless Components

Complete payment integration demo showcasing SolvaPay's headless React components with locked content and subscription gates.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the Demo](#running-the-demo)
- [Demo Flow](#demo-flow)
- [Testing Payments](#testing-payments)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Key Concepts](#key-concepts)
- [Environment Variables](#environment-variables)
- [Customization](#customization)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Related Documentation](#related-documentation)

## Features

- 🎯 **Headless Components**: Fully flexible, unstyled components with render props
- 🔒 **Content Gating**: Lock premium features behind subscriptions
- 💳 **Secure Payments**: Stripe-powered payment processing
- 📊 **Subscription Management**: Real-time subscription status checking
- 🔐 **Authentication**: Email/password and Google OAuth sign-in with Supabase
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

2. **Supabase Account** (for authentication)
   - Sign up at https://supabase.com
   - Create a new project
   - Get your project URL and anon key from Settings → API
   - Get your JWT secret from Settings → API → JWT Secret
   - **Enable Google OAuth** (optional):
     - First, create OAuth credentials in Google Cloud Console (see detailed steps below)
     - Then in Supabase: Authentication → Providers → Google
     - Enable the provider and paste your Google OAuth Client ID and Client Secret
     - **Important**: Client IDs field should contain only the Client ID (no spaces, like "123456789-abc.apps.googleusercontent.com")
     - Copy the Callback URL shown (e.g., `https://ganvogeprtezdpakybib.supabase.co/auth/v1/callback`)
     - Add this Callback URL to Google Cloud Console as an authorized redirect URI
     - Add your app's callback URL (`http://localhost:3000/auth/callback`) to Supabase Redirect URLs

3. **Environment Variables**
   - Copy `env.example` to `.env.local`
   - Fill in your SolvaPay and Supabase credentials

## Setup

```bash
# Install dependencies (from workspace root)
pnpm install

# Navigate to the demo
cd examples/checkout-demo

# Copy environment variables
cp env.example .env.local

# Edit .env.local with your SolvaPay and Supabase credentials
# Required: SOLVAPAY_SECRET_KEY, SUPABASE_JWT_SECRET, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
# Optional: SOLVAPAY_API_BASE_URL, NEXT_PUBLIC_AGENT_REF
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

### 2. Authentication Setup

This demo uses Supabase for authentication with Next.js middleware as the default approach:

**Middleware Approach (Default):**

The `middleware.ts` file extracts user IDs from Supabase JWT tokens and sets them as headers for all API routes:

```tsx
// middleware.ts
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

const auth = new SupabaseAuthAdapter({
  jwtSecret: process.env.SUPABASE_JWT_SECRET!
});

export async function middleware(request: NextRequest) {
  const userId = await auth.getUserIdFromRequest(request);
  
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Set userId header for downstream routes
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', userId);
  
  return NextResponse.next({ request: { headers: requestHeaders } });
}
```

**Route-Level Approach (Alternative):**

You can also use SupabaseAuthAdapter directly in individual routes if you prefer:

```tsx
// app/api/create-payment-intent/route.ts
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

const auth = new SupabaseAuthAdapter({
  jwtSecret: process.env.SUPABASE_JWT_SECRET!
});

export async function POST(request: NextRequest) {
  const userId = await auth.getUserIdFromRequest(request);
  
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Use userId as cache key and externalRef
  // The ensureCustomer method returns the SolvaPay backend customer reference
  const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY! });
  const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId);
  const customer = await solvaPay.getCustomer({ customerRef: ensuredCustomerRef });
  // ...
}
```

The frontend sends the Supabase access token in the Authorization header:

```tsx
// app/layout.tsx
import { getAccessToken } from './lib/supabase';

const handleCreatePayment = async ({ planRef }) => {
  const accessToken = await getAccessToken();
  const res = await fetch('/api/create-payment-intent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
    },
    body: JSON.stringify({ planRef, agentRef })
  });
  return res.json();
};
```

### 3. Locked Content with SubscriptionGate

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

### 4. Navigation with Plan Badge

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

### 5. Backend API Routes

**Check Subscription:**
```typescript
// app/api/check-subscription/route.ts
import { createSolvaPay } from '@solvapay/server';
// Middleware handles authentication and sets x-user-id header

export async function GET(request: NextRequest) {
  // Get userId from middleware header
  const userId = request.headers.get('x-user-id');
  
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const solvapay = createSolvaPay({
    apiKey: process.env.SOLVAPAY_SECRET_KEY!
  });
  
  const customer = await solvapay.getCustomer({ customerRef: userId });
  
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
// Middleware handles authentication and sets x-user-id header

export async function POST(request: NextRequest) {
  // Get userId from middleware header
  const userId = request.headers.get('x-user-id');
  
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const { planRef, agentRef } = await request.json();
  
  const solvapay = createSolvaPay({
    apiKey: process.env.SOLVAPAY_SECRET_KEY!
  });
  
  await solvapay.ensureCustomer(userId);
  
  const paymentIntent = await solvapay.createPaymentIntent({
    agentRef,
    planRef,
    customerRef: userId
  });
  
  return NextResponse.json({
    clientSecret: paymentIntent.clientSecret,
    publishableKey: paymentIntent.publishableKey,
    accountId: paymentIntent.accountId
  });
}
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
│   │   ├── customer.ts           # Customer ID management (Supabase auth)
│   │   └── supabase.ts           # Supabase client setup
│   ├── checkout/
│   │   └── page.tsx              # Checkout page with plan selection
│   ├── layout.tsx                # Root layout with SolvaPayProvider
│   └── page.tsx                  # Home with locked content
├── middleware.ts                 # Authentication middleware (extracts userId)
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

### Authentication

This demo uses Supabase for authentication with Next.js middleware as the default approach:
- Middleware extracts user IDs from Supabase JWT tokens on all `/api/*` routes
- User IDs are set as `x-user-id` header for downstream routes
- Middleware returns 401 if authentication fails
- The frontend sends access tokens in Authorization headers
- The Supabase user ID is stored as `externalRef` on the SolvaPay backend
- The `customerRef` prop passed to `SolvaPayProvider` uses the Supabase user ID as a cache key (the actual SolvaPay backend customer reference is returned from API calls)
- Individual routes can optionally use SupabaseAuthAdapter directly (see route comments)

**Sign-in Methods:**
- Email/password authentication
- Google OAuth (requires Google OAuth setup in Supabase dashboard)

**Google OAuth Setup:**

1. **In Google Cloud Console:**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Navigate to APIs & Services → Credentials
   - Create OAuth 2.0 Client ID (or use existing)
   - Copy the **Client ID** and **Client Secret**
   - Add authorized redirect URI: `https://[your-project-ref].supabase.co/auth/v1/callback`
   - Example: `https://ganvogeprtezdpakybib.supabase.co/auth/v1/callback`
   - **Note**: This is Supabase's internal callback URL (read-only in Supabase dashboard)

2. **In Supabase Dashboard:**
   - Go to Authentication → Providers → Google
   - Enable Google provider (toggle ON)
   - **Client IDs**: Paste your Google OAuth Client ID (no spaces, just the ID)
   - **Client Secret (for OAuth)**: Paste your Google OAuth Client Secret
   - **Callback URL**: This is read-only - Supabase handles the OAuth callback internally at this URL
   - Add your app's callback URL to Site URL or Redirect URLs:
     - Go to Authentication → URL Configuration
     - Add to Redirect URLs: `http://localhost:3000/auth/callback` (for local dev)
     - Add production URL when deploying: `https://yourdomain.com/auth/callback`

**How it works:**
1. User clicks "Sign in with Google" → redirects to Supabase → Google
2. Google redirects back to Supabase's callback URL (read-only, handled by Supabase)
3. Supabase processes the OAuth and redirects to your app's callback URL (`/auth/callback`)
4. Your app's callback handler receives the session and syncs the customer

**Important:** 
- The Supabase callback URL (`https://[your-project-ref].supabase.co/auth/v1/callback`) goes in Google Cloud Console
- Your app's callback URL (`http://localhost:3000/auth/callback`) goes in Supabase dashboard Redirect URLs
- The Supabase callback URL is read-only - Supabase handles it automatically

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SOLVAPAY_SECRET_KEY` | Your SolvaPay secret key | Yes |
| `SOLVAPAY_API_BASE_URL` | Backend URL (defaults to prod) | No |
| `NEXT_PUBLIC_AGENT_REF` | Agent reference | No |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key | Yes |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret (for server verification) | Yes |

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

## Best Practices

### 1. Provider Setup

Always wrap your app with `SolvaPayProvider` at the root level:

```tsx
// app/layout.tsx
<SolvaPayProvider
  customerRef={customerId}
  createPayment={handleCreatePayment}
  checkSubscription={handleCheckSubscription}
>
  {children}
</SolvaPayProvider>
```

### 2. Error Handling

Handle errors in your API callbacks:

```tsx
const handleCreatePayment = async ({ planRef, customerRef }) => {
  try {
    const res = await fetch('/api/create-payment-intent', {
      method: 'POST',
      body: JSON.stringify({ planRef, customerRef, agentRef })
    });
    
    if (!res.ok) {
      throw new Error('Payment intent creation failed');
    }
    
    return res.json();
  } catch (error) {
    console.error('Payment error:', error);
    throw error; // Re-throw to let provider handle it
  }
};
```

### 3. Subscription Refetching

Always refetch subscription after successful payment:

```tsx
const { refetch } = useSubscription();

const handlePaymentSuccess = async () => {
  await refetch(); // Update subscription status
  // Navigate or show success message
};
```

### 4. Loading States

Use loading states from hooks:

```tsx
const { loading, subscriptions } = useSubscription();

if (loading) {
  return <Spinner />;
}
```

### 5. Type Safety

Use TypeScript types from the SDK:

```tsx
import type { SubscriptionStatus } from '@solvapay/react';

const status: SubscriptionStatus = subscription.status;
```

### 6. Environment Variables

Never commit `.env.local` files and document all required variables:

```bash
# .env.local (never commit)
SOLVAPAY_SECRET_KEY=your_key_here
SUPABASE_JWT_SECRET=your_secret_here
```

## Troubleshooting

### "Missing SOLVAPAY_SECRET_KEY"

**Problem**: Error about missing secret key.

**Solution**:
1. Ensure `.env.local` exists in the example directory
2. Copy from `env.example` if needed: `cp env.example .env.local`
3. Add your SolvaPay secret key to `.env.local`
4. Restart the dev server after adding environment variables
5. Verify the variable name is exactly `SOLVAPAY_SECRET_KEY`

### "Payment intent creation failed"

**Problem**: Payment intent creation returns an error.

**Solution**:
1. Check your SolvaPay API key is valid in the dashboard
2. Verify the backend URL is correct (`SOLVAPAY_API_BASE_URL`)
3. Check network tab for API errors and status codes
4. Verify agent and plan references match your dashboard
5. Check server logs for detailed error messages
6. Ensure API route is properly handling authentication

### Subscription not updating after payment

**Problem**: Payment succeeds but subscription status doesn't update.

**Solution**:
1. Check that `refetch()` is called after successful payment:
   ```tsx
   const { refetch } = useSubscription();
   await refetch();
   ```
2. Verify API returns proper subscription format
3. Check browser console for errors
4. Verify customer reference matches between frontend and backend
5. Check that webhook is configured (if using webhooks)
6. Wait a few seconds and manually refetch

### Components not rendering

**Problem**: SolvaPay components don't appear or throw errors.

**Solution**:
1. Ensure you're inside `<SolvaPayProvider>`:
   ```tsx
   <SolvaPayProvider {...props}>
     <YourComponent />
   </SolvaPayProvider>
   ```
2. Check that hooks are called in functional components (not class components)
3. Verify all required props are provided to provider
4. Check browser console for React errors
5. Verify customer reference is available

### "Unauthorized" errors

**Problem**: API routes return 401 Unauthorized.

**Solution**:
1. Verify Supabase credentials are correct
2. Check that `SUPABASE_JWT_SECRET` matches your project settings
3. Ensure middleware is properly extracting user ID
4. Verify access token is being sent in Authorization header
5. Check Supabase project has email/password auth enabled
6. Review middleware logs for authentication errors

### Payment form not appearing

**Problem**: Clicking upgrade button doesn't show payment form.

**Solution**:
1. Check that `createPayment` callback is provided to provider
2. Verify callback returns proper format with `clientSecret`
3. Check browser console for errors
4. Ensure Stripe publishable key is available
5. Verify payment intent creation succeeds

### Google OAuth "redirect_uri_mismatch" Error (Error 400)

This error occurs when Google doesn't recognize the redirect URI that Supabase is using.

**The Fix:**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **APIs & Services → Credentials**
3. Click on your **OAuth 2.0 Client ID**
4. Scroll down to **Authorized redirect URIs**
5. Click **+ ADD URI**
6. Add your Supabase callback URL exactly as shown in Supabase dashboard:
   - `https://[your-project-ref].supabase.co/auth/v1/callback`
   - Example: `https://ganvogeprtezdpakybib.supabase.co/auth/v1/callback`
7. Click **SAVE**

**Important Notes:**
- Google sees Supabase's callback URL (`https://ganvogeprtezdpakybib.supabase.co/auth/v1/callback`), NOT your localhost URL
- The `redirectTo` option (`localhost:3000/auth/callback`) is where Supabase redirects AFTER processing OAuth
- You must add the Supabase callback URL to Google Cloud Console, not localhost
- Make sure the URL matches exactly (including the `/auth/v1/callback` path)
- After adding the URI, wait a few minutes for changes to propagate

**For Production:**
- You'll need to add your production Supabase callback URL if different
- Your app's callback URL (`https://yourdomain.com/auth/callback`) goes in Supabase dashboard Redirect URLs, not Google Cloud Console

## Related Documentation

### Getting Started
- [Examples Overview](../../docs/examples/overview.md) - Overview of all examples
- [Installation Guide](../../docs/getting-started/installation.md) - SDK installation
- [Quick Start Guide](../../docs/getting-started/quick-start.md) - Quick setup guide
- [Core Concepts](../../docs/getting-started/core-concepts.md) - Understanding agents, plans, and paywalls

### Framework Guides
- [React Integration Guide](../../docs/guides/react.md) - Complete React integration guide
- [Next.js Integration Guide](../../docs/guides/nextjs.md) - Next.js specific patterns
- [Custom Authentication Adapters](../../docs/guides/custom-auth.md) - Custom auth setup
- [Error Handling Guide](../../docs/guides/error-handling.md) - Error handling patterns

### API Reference
- [React SDK API Reference](../../docs/api/react/) - Complete React component documentation
- [Server SDK API Reference](../../docs/api/server/) - Backend API documentation
- [Next.js SDK API Reference](../../docs/api/next/) - Next.js helper documentation

### Additional Resources
- [SolvaPay Documentation](https://docs.solvapay.com) - Official documentation
- [Headless Components Pattern](https://www.patterns.dev/posts/headless-ui) - Headless UI patterns
- [Stripe Testing Documentation](https://stripe.com/docs/testing) - Test card numbers
- [Next.js Documentation](https://nextjs.org/docs) - Next.js framework docs
- [GitHub Repository](https://github.com/solvapay/solvapay-sdk) - Source code and issues

## Support

For issues or questions:
- GitHub Issues: https://github.com/solvapay/solvapay-sdk/issues
- Documentation: https://docs.solvapay.com
- Email: support@solvapay.com
