# SolvaPay Hosted Checkout Demo

Complete payment integration demo showcasing SolvaPay's hosted checkout flow with subscription management and content gating.

## Features

- 🎯 **Hosted Checkout**: Secure checkout hosted on app.solvapay.com (similar to Stripe Checkout)
- 🔒 **Content Gating**: Lock premium features behind subscriptions
- 📊 **Subscription Management**: Real-time subscription status checking
- 🔐 **Customer Portal**: Hosted subscription management page (similar to Stripe Customer Portal)
- 🔐 **Authentication**: Email/password and Google OAuth sign-in with Supabase
- 🧪 **Test Mode**: Complete test environment with localStorage persistence

## Architecture

This demo uses **hosted checkout** - users are redirected to `app.solvapay.com` for checkout and subscription management, similar to Stripe Checkout and Stripe Customer Portal.

### Flow Overview

1. **Checkout Flow**:
   - User clicks "View Plans" or "Upgrade"
   - Frontend calls `/api/create-checkout-token` to generate a secure token
   - User is redirected to `app.solvapay.com/checkout?token=<token>`
   - User completes checkout on hosted page
   - User is redirected back to app after successful checkout

2. **Subscription Management Flow**:
   - User clicks "Manage Subscription"
   - Frontend calls `/api/create-manage-customer-token` to generate a secure token
   - User is redirected to `app.solvapay.com/customer?token=<token>`
   - User manages subscription on hosted page
   - User is redirected back to app when done

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
cd examples/hosted-checkout-demo

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

1. **Home Page**: View locked premium content and subscription status
2. **Click Upgrade**: Redirects to hosted checkout page
3. **Complete Payment**: Use test card (4242 4242 4242 4242) on hosted page
4. **Return to App**: Automatically redirected back after successful checkout
5. **View Unlocked Content**: Premium features are instantly available
6. **Manage Subscription**: Click "Manage Subscription" to access hosted customer portal

## Testing Payments

The hosted checkout page accepts standard Stripe test cards:

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
  checkSubscription={async (customerRef) => {
    const res = await fetch(`/api/check-subscription?customerRef=${customerRef}`);
    return res.json();
  }}
>
  {children}
</SolvaPayProvider>
```

**Note**: `createPayment` and `processPayment` callbacks are not needed for hosted checkout - users are redirected to hosted pages instead.

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

The frontend sends the Supabase access token in the Authorization header:

```tsx
// app/page.tsx
import { getAccessToken } from './lib/supabase';

const handleViewPlans = async () => {
  const accessToken = await getAccessToken();
  const res = await fetch('/api/create-checkout-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
    },
    body: JSON.stringify({ agentRef })
  });
  const { checkoutUrl } = await res.json();
  window.location.href = checkoutUrl; // Redirect to hosted checkout
};
```

### 3. Hosted Checkout Token Generation

```typescript
// app/api/create-checkout-token/route.ts
import { createSolvaPay } from '@solvapay/server';
import { requireUserId } from '@solvapay/auth';

export async function POST(request: NextRequest) {
  // Get userId from middleware
  const userId = requireUserId(request);
  
  const { agentRef, planRef } = await request.json();
  
  const solvaPay = createSolvaPay();
  
  // Ensure customer exists
  const customerRef = await solvaPay.ensureCustomer(userId, userId);
  
  // Call backend API to create checkout token
  const apiBaseUrl = process.env.SOLVAPAY_API_BASE_URL || 'https://api-dev.solvapay.com';
  const response = await fetch(`${apiBaseUrl}/api/create-checkout-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SOLVAPAY_SECRET_KEY}`,
    },
    body: JSON.stringify({
      agentRef,
      customerRef,
      planRef, // Optional
    }),
  });
  
  const { token } = await response.json();
  
  return NextResponse.json({
    token,
    checkoutUrl: `https://app.solvapay.com/checkout?token=${token}`,
  });
}
```

### 4. Hosted Customer Management Token Generation

```typescript
// app/api/create-manage-customer-token/route.ts
import { createSolvaPay } from '@solvapay/server';
import { requireUserId } from '@solvapay/auth';

export async function POST(request: NextRequest) {
  // Get userId from middleware
  const userId = requireUserId(request);
  
  const solvaPay = createSolvaPay();
  
  // Ensure customer exists
  const customerRef = await solvaPay.ensureCustomer(userId, userId);
  
  // Call backend API to create customer management token
  const apiBaseUrl = process.env.SOLVAPAY_API_BASE_URL || 'https://api-dev.solvapay.com';
  const response = await fetch(`${apiBaseUrl}/api/create-manage-customer-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SOLVAPAY_SECRET_KEY}`,
    },
    body: JSON.stringify({
      customerRef,
    }),
  });
  
  const { token } = await response.json();
  
  return NextResponse.json({
    token,
    customerUrl: `https://app.solvapay.com/customer?token=${token}`,
  });
}
```

### 5. Redirecting to Hosted Pages

```tsx
// app/page.tsx
const handleViewPlans = async () => {
  try {
    const accessToken = await getAccessToken();
    const response = await fetch('/api/create-checkout-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
      },
      body: JSON.stringify({ agentRef }),
    });
    
    const { checkoutUrl } = await response.json();
    window.location.href = checkoutUrl; // Redirect to hosted checkout
  } catch (error) {
    // Handle error
  }
};

const handleManageSubscription = async () => {
  try {
    const accessToken = await getAccessToken();
    const response = await fetch('/api/create-manage-customer-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
      },
    });
    
    const { customerUrl } = await response.json();
    window.location.href = customerUrl; // Redirect to hosted customer portal
  } catch (error) {
    // Handle error
  }
};
```

### 6. Locked Content with SubscriptionGate

```tsx
// app/page.tsx
import { SubscriptionGate } from '@solvapay/react';

<SubscriptionGate requirePlan="Pro Plan">
  {({ hasAccess, loading }) => {
    if (loading) return <Skeleton />;
    
    if (!hasAccess) {
      return (
        <div>
          <h2>🔒 Premium Content</h2>
          <button onClick={handleViewPlans}>
            Upgrade Now
          </button>
        </div>
      );
    }
    
    return <PremiumContent />;
  }}
</SubscriptionGate>
```

### 7. Navigation with Plan Badge

```tsx
// app/components/Navigation.tsx
import { PlanBadge } from '@solvapay/react';

<PlanBadge>
  {({ displayPlan, shouldShow }) => {
    if (!shouldShow) return null;
    return (
      <div className="px-2.5 py-1 rounded-md bg-slate-50 text-xs font-medium">
        <span className="text-emerald-600">{displayPlan}</span>
      </div>
    );
  }}
</PlanBadge>

<button onClick={handleViewPlans}>
  Upgrade
</button>
```

## Project Structure

```
hosted-checkout-demo/
├── app/
│   ├── api/
│   │   ├── create-checkout-token/
│   │   │   └── route.ts          # Creates checkout token, returns hosted URL
│   │   ├── create-manage-customer-token/
│   │   │   └── route.ts          # Creates management token, returns hosted URL
│   │   ├── check-subscription/
│   │   │   └── route.ts          # Subscription status check
│   │   └── sync-customer/
│   │       └── route.ts          # Ensure customer exists
│   ├── components/
│   │   └── Navigation.tsx        # Nav with PlanBadge and upgrade button
│   ├── lib/
│   │   ├── customer.ts           # Customer ID management (Supabase auth)
│   │   └── supabase.ts           # Supabase client setup
│   ├── layout.tsx                # Root layout with SolvaPayProvider
│   └── page.tsx                   # Home with locked content
├── middleware.ts                 # Authentication middleware (extracts userId)
├── package.json
├── next.config.mjs
├── tsconfig.json
├── env.example
└── README.md
```

## Key Concepts

### Hosted Checkout vs Embedded Checkout

**Hosted Checkout (this demo)**:
- Users redirected to `app.solvapay.com` for checkout
- Payment form handled entirely by SolvaPay
- Similar to Stripe Checkout hosted pages
- Lower PCI compliance burden
- Consistent checkout experience

**Embedded Checkout (checkout-demo)**:
- Payment form embedded in your app
- More customization control
- Requires more PCI compliance considerations
- See `examples/checkout-demo` for embedded checkout example

### Token-Based Access

Tokens are generated server-side and passed as query parameters to hosted pages:
- Checkout tokens: Single-use tokens for checkout sessions
- Management tokens: Tokens for accessing customer portal
- Tokens are time-limited and secure (handled by backend)

### Subscription State Management

The provider automatically:
- Fetches subscription on mount
- Provides refetch method for updates
- Exposes helper methods (`hasActiveSubscription`, `hasPlan`)
- Manages loading states

### Authentication

This demo uses Supabase for authentication:
- Middleware extracts user IDs from Supabase JWT tokens on all `/api/*` routes
- User IDs are set as `x-user-id` header for downstream routes
- Middleware returns 401 if authentication fails
- The frontend sends access tokens in Authorization headers
- The Supabase user ID is stored as `externalRef` on the SolvaPay backend
- The `customerRef` prop passed to `SolvaPayProvider` uses the Supabase user ID as a cache key (the actual SolvaPay backend customer reference is returned from API calls)

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

2. **In Supabase Dashboard:**
   - Go to Authentication → Providers → Google
   - Enable Google provider (toggle ON)
   - **Client IDs**: Paste your Google OAuth Client ID (no spaces, just the ID)
   - **Client Secret (for OAuth)**: Paste your Google OAuth Client Secret
   - Add your app's callback URL to Redirect URLs: `http://localhost:3000/auth/callback`

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SOLVAPAY_SECRET_KEY` | Your SolvaPay secret key | Yes |
| `SOLVAPAY_API_BASE_URL` | Backend URL (defaults to prod) | No |
| `NEXT_PUBLIC_AGENT_REF` | Agent reference | No |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key | Yes |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret (for server verification) | Yes |

## Backend Endpoints

This demo expects the following backend endpoints to be implemented:

### Create Checkout Token
- **Endpoint**: `POST /api/create-checkout-token`
- **Request**: `{ agentRef: string, customerRef: string, planRef?: string }`
- **Response**: `{ token: string }`

### Create Manage Customer Token
- **Endpoint**: `POST /api/create-manage-customer-token`
- **Request**: `{ customerRef: string }`
- **Response**: `{ token: string }`

These endpoints should be implemented on the SolvaPay backend and will be called by the Next.js API routes.

## Troubleshooting

### "Missing SOLVAPAY_SECRET_KEY"
- Ensure `.env.local` exists with your secret key
- Restart the dev server after adding environment variables

### "Failed to create checkout token"
- Check your SolvaPay API key is valid
- Verify the backend URL is correct (`SOLVAPAY_API_BASE_URL`)
- Ensure backend endpoint `/api/create-checkout-token` is implemented
- Check network tab for API errors

### "Backend did not return a token"
- Verify backend endpoint is returning `{ token: string }` in response
- Check backend logs for errors

### Subscription not updating after checkout
- Check that `refetch()` is called after returning from hosted checkout
- Verify API returns proper subscription format
- Check browser console for errors
- Ensure return URL is configured correctly on backend

### Components not rendering
- Ensure you're inside `<SolvaPayProvider>`
- Check that hooks are called in functional components
- Verify all required props are provided

### Google OAuth "redirect_uri_mismatch" Error

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **APIs & Services → Credentials**
3. Click on your **OAuth 2.0 Client ID**
4. Add your Supabase callback URL: `https://[your-project-ref].supabase.co/auth/v1/callback`
5. Click **SAVE**

**Important**: Google sees Supabase's callback URL, NOT your localhost URL. The `redirectTo` option is where Supabase redirects AFTER processing OAuth.

## Learn More

- [SolvaPay Documentation](https://docs.solvapay.com)
- [Stripe Checkout Documentation](https://stripe.com/docs/payments/checkout) (similar pattern)
- [Next.js Documentation](https://nextjs.org/docs)

## Support

For issues or questions:
- GitHub Issues: https://github.com/solvapay/solvapay-sdk/issues
- Documentation: https://docs.solvapay.com
- Email: support@solvapay.com
