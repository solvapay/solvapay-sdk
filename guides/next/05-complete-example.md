# Step 5: Complete Example

This guide provides a complete working example that ties everything together.

## Overview

This example includes:
- Complete home page with subscription status
- Feature cards with premium gating
- Subscription management UI
- Sign-out functionality
- Error handling
- Loading states

## Complete Home Page

Update `app/page.tsx` with the full implementation:

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSubscription, useSubscriptionStatus } from '@solvapay/react';
import { getAccessToken, signOut } from './lib/supabase';
import { useRouter } from 'next/navigation';
import { Button } from './components/ui/Button';
import { Card } from './components/ui/Card';
import { Badge } from './components/ui/Badge';

export default function HomePage() {
  const router = useRouter();
  const agentRef = process.env.NEXT_PUBLIC_AGENT_REF;
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Get subscription helpers from SDK
  const { subscriptions, loading: subscriptionsLoading, refetch, hasPaidSubscription, activeSubscription } = useSubscription();
  
  // Refetch subscriptions on mount to ensure we have latest data after navigation
  useEffect(() => {
    refetch().catch((error) => {
      console.error('[HomePage] Refetch failed:', error);
    });
  }, [refetch]);
  
  // Get advanced subscription status helpers
  const {
    cancelledSubscription,
    shouldShowCancelledNotice,
    formatDate,
    getDaysUntilExpiration,
  } = useSubscriptionStatus();

  const isLoading = subscriptionsLoading;

  // Handle redirect to hosted checkout page
  const handleViewPlans = useCallback(async (planRef?: string) => {
    if (!agentRef) {
      setError('Agent reference is not configured');
      return;
    }

    setIsRedirecting(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const requestBody: { agentRef: string; planRef?: string } = {
        agentRef,
      };

      if (planRef) {
        requestBody.planRef = planRef;
      }

      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.details || 'Failed to create checkout session';
        throw new Error(errorMessage);
      }

      const { checkoutUrl } = await response.json();

      if (!checkoutUrl) {
        throw new Error('No checkout URL returned');
      }

      // Redirect to hosted checkout page
      window.location.href = checkoutUrl;
    } catch (err) {
      console.error('Failed to redirect to checkout:', err);
      setError(err instanceof Error ? err.message : 'Failed to redirect to checkout');
      setIsRedirecting(false);
    }
  }, [agentRef]);

  // Handle redirect to hosted customer management page
  const handleManageSubscription = useCallback(async () => {
    setIsRedirecting(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch('/api/create-customer-session', {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.details || 'Failed to create customer session';
        throw new Error(errorMessage);
      }

      const { customerUrl } = await response.json();

      if (!customerUrl) {
        throw new Error('No customer URL returned');
      }

      // Redirect to hosted customer management page
      window.location.href = customerUrl;
    } catch (err) {
      console.error('Failed to redirect to customer management:', err);
      setError(err instanceof Error ? err.message : 'Failed to redirect to customer management');
      setIsRedirecting(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      router.push('/');
    } catch (err) {
      console.error('Failed to sign out:', err);
      setIsSigningOut(false);
    }
  }, [router]);

  // Feature card component
  const FeatureCard = ({ 
    title, 
    description, 
    locked = false 
  }: { 
    title: string; 
    description: string; 
    locked?: boolean;
  }) => (
    <div className={`p-6 rounded-xl border ${locked ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'} relative`}>
      {locked && (
        <div className="absolute top-4 right-4">
          <Badge variant="premium">Premium</Badge>
        </div>
      )}
      <h3 className={`text-lg font-medium mb-2 ${locked ? 'text-slate-500' : 'text-slate-900'}`}>
        {title}
      </h3>
      <p className={`text-sm ${locked ? 'text-slate-400' : 'text-slate-600'}`}>
        {description}
      </p>
      {locked && (
        <div className="mt-4">
          <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
      )}
    </div>
  );

  // Skeleton loader component
  const Skeleton = ({ className = '' }: { className?: string }) => (
    <div className={`animate-pulse bg-slate-200 rounded ${className}`} />
  );

  return (
    <div className="min-h-screen bg-white">
      <main className="max-w-4xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900 mb-2">Welcome</h1>
            {isLoading ? (
              <Skeleton className="h-5 w-48" />
            ) : activeSubscription ? (
              <p className="text-slate-600">
                You're on the <Badge variant="premium">{activeSubscription.planName}</Badge> plan
              </p>
            ) : shouldShowCancelledNotice && cancelledSubscription ? (
              <div className="space-y-2">
                <p className="text-slate-600">
                  Your <Badge variant="premium">{cancelledSubscription.planName}</Badge> subscription has been cancelled
                </p>
                {cancelledSubscription.endDate && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm font-medium text-amber-900">
                      ⏰ Access expires on {formatDate(cancelledSubscription.endDate)}
                    </p>
                    {(() => {
                      const daysLeft = getDaysUntilExpiration(cancelledSubscription.endDate);
                      return daysLeft !== null && daysLeft > 0 ? (
                        <p className="text-xs text-amber-700 mt-1">
                          {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
                        </p>
                      ) : null;
                    })()}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-600">You don't have an active subscription</p>
            )}
          </div>
          <Button
            onClick={handleSignOut}
            disabled={isSigningOut}
            variant="secondary"
            className="text-sm"
          >
            {isSigningOut ? 'Signing out...' : 'Sign Out'}
          </Button>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <FeatureCard
            title="Basic Analytics"
            description="View your daily stats and basic metrics."
          />
          <FeatureCard
            title="Standard Reports"
            description="Generate monthly reports with key insights."
          />
          <FeatureCard
            title="Advanced Analytics"
            description="Real-time data analysis with custom dashboards."
            locked={!isLoading && !hasPaidSubscription}
          />
          <FeatureCard
            title="Priority Support"
            description="Get help from our team within 24 hours."
            locked={!isLoading && !hasPaidSubscription}
          />
        </div>

        {/* CTA Section */}
        <Card className="p-8">
          {isLoading ? (
            <div className="text-center py-4 space-y-4">
              <Skeleton className="h-5 w-64 mx-auto" />
              <Skeleton className="h-10 w-48 mx-auto" />
            </div>
          ) : hasPaidSubscription ? (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-4">Manage your subscription and billing</p>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <Button onClick={handleManageSubscription} disabled={isRedirecting} className="w-full sm:w-auto">
                {isRedirecting ? 'Redirecting...' : 'Manage Subscription'}
              </Button>
            </div>
          ) : shouldShowCancelledNotice && cancelledSubscription ? (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-2 font-medium">Your subscription is cancelled</p>
              {cancelledSubscription.endDate && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm font-semibold text-amber-900 mb-1">
                    ⏰ Subscription Expires: {formatDate(cancelledSubscription.endDate)}
                  </p>
                  {(() => {
                    const daysLeft = getDaysUntilExpiration(cancelledSubscription.endDate);
                    return daysLeft !== null && daysLeft > 0 ? (
                      <p className="text-xs text-amber-700 mb-1">
                        {daysLeft} {daysLeft === 1 ? 'day' : 'days'} remaining
                      </p>
                    ) : null;
                  })()}
                  <p className="text-xs text-amber-700">
                    You'll continue to have access to {cancelledSubscription.planName} features until this date
                  </p>
                </div>
              )}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <Button onClick={() => handleViewPlans()} disabled={isRedirecting} className="w-full sm:w-auto">
                {isRedirecting ? 'Redirecting...' : 'Resubscribe'}
              </Button>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-slate-900 mb-2 font-medium">Upgrade your plan</p>
              <p className="text-slate-600 text-sm mb-6">Get access to advanced features and more</p>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
              <Button onClick={() => handleViewPlans()} disabled={isRedirecting} className="w-full sm:w-auto">
                {isRedirecting ? 'Redirecting...' : 'Upgrade'}
              </Button>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
```

## Complete Project Structure

Your project should now have this structure:

```
my-app/
├── app/
│   ├── api/
│   │   ├── check-subscription/
│   │   │   └── route.ts
│   │   ├── create-checkout-session/
│   │   │   └── route.ts
│   │   ├── create-customer-session/
│   │   │   └── route.ts
│   │   └── sync-customer/
│   │       └── route.ts
│   ├── auth/
│   │   └── callback/
│   │       └── page.tsx
│   ├── components/
│   │   ├── ui/
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Form.tsx
│   │   │   └── FormField.tsx
│   │   └── Auth.tsx
│   ├── lib/
│   │   ├── customer.ts
│   │   └── supabase.ts
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── middleware.ts
├── tailwind.config.ts
├── postcss.config.js
├── package.json
├── tsconfig.json
├── next.config.mjs
└── .env.local
```

## Verification Checklist

Test your complete implementation:

### Authentication
- [ ] Sign up with email/password works
- [ ] Sign in with email/password works
- [ ] Google OAuth sign-in works (if configured)
- [ ] Sign out works
- [ ] Auth state persists across page refreshes
- [ ] Unauthenticated users see auth form
- [ ] Authenticated users see app content

### Payments
- [ ] "Upgrade" button redirects to checkout
- [ ] Checkout session is created successfully
- [ ] Test payment completes successfully
- [ ] User is redirected back after payment
- [ ] Subscription status updates after payment
- [ ] "Manage Subscription" button appears when subscribed
- [ ] Customer portal redirects correctly

### UI/UX
- [ ] Loading states display correctly
- [ ] Error messages display correctly
- [ ] Premium features are locked for free users
- [ ] Premium features unlock for paid users
- [ ] Subscription status displays correctly
- [ ] Cancelled subscription notice displays (if applicable)
- [ ] All buttons have proper hover/focus states

## Testing Guide

### Test Payment Flow

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Sign up:**
   - Visit http://localhost:3000
   - Click "Don't have an account? Sign up"
   - Fill in name, email, and password
   - Submit form

3. **Upgrade subscription:**
   - Click "Upgrade" button
   - You should be redirected to hosted checkout
   - Use test card: `4242 4242 4242 4242`
   - Complete payment
   - You should be redirected back to app

4. **Verify subscription:**
   - Subscription status should show active plan
   - "Manage Subscription" button should appear
   - Premium features should be unlocked

5. **Manage subscription:**
   - Click "Manage Subscription"
   - You should be redirected to customer portal
   - Can view subscription, payment methods, billing history

### Test Cancelled Subscription

1. **Cancel subscription in customer portal:**
   - Go to customer portal
   - Cancel subscription
   - Return to app

2. **Verify cancelled state:**
   - Cancelled notice should display
   - Expiration date should show
   - Days remaining should calculate correctly
   - "Resubscribe" button should appear

## Common Issues and Solutions

### Issue: Subscription not updating after checkout

**Solution:**
- Ensure `refetch()` is called after returning from checkout
- Check that `/api/check-subscription` returns correct format
- Verify customerRef matches between checkout and subscription check
- Check browser console for errors

### Issue: "Agent reference is not configured"

**Solution:**
- Ensure `NEXT_PUBLIC_AGENT_REF` is set in `.env.local`
- Restart dev server after adding environment variables
- Verify agent reference exists in SolvaPay dashboard

### Issue: Premium features not unlocking

**Solution:**
- Verify `hasPaidSubscription` is correctly checking subscription amount
- Check that subscription amount > 0 for paid plans
- Ensure subscription check is completing successfully
- Check browser console for subscription errors

### Issue: Sign out not working

**Solution:**
- Verify `signOut` function in `lib/supabase.ts` is correct
- Check browser console for errors
- Ensure router is properly imported and used

## Next Steps

Now that you have a complete implementation, consider:

1. **Customization:**
   - Customize colors and styling to match your brand
   - Add your logo and branding
   - Customize feature cards and content

2. **Enhanced Features:**
   - Add password reset flow
   - Add email verification UI
   - Add user profile page
   - Add subscription usage tracking

3. **Production Deployment:**
   - Set up production environment variables
   - Configure production Supabase project
   - Set up production SolvaPay account
   - Add error tracking (Sentry, etc.)
   - Add analytics

4. **Security:**
   - Review security best practices
   - Set up rate limiting
   - Add CSRF protection
   - Review API route security

## Additional Resources

- **SolvaPay Documentation**: https://docs.solvapay.com
- **Supabase Documentation**: https://supabase.com/docs
- **Next.js Documentation**: https://nextjs.org/docs
- **Tailwind CSS Documentation**: https://tailwindcss.com/docs
- **Example Implementation**: `examples/hosted-checkout-demo`

## Summary

You've successfully built a complete Next.js application with:
- ✅ Supabase authentication (email/password + Google OAuth)
- ✅ SolvaPay hosted checkout
- ✅ Subscription management
- ✅ Modern UI components
- ✅ Premium feature gating
- ✅ Error handling and loading states

The implementation follows best practices and provides a solid foundation for building a subscription-based SaaS application.

