# Adding Sign In and Sign Up Pages to Next.js with Supabase

## Overview

This guide provides step-by-step instructions for adding dedicated sign-in and sign-up pages to a Next.js React application using Supabase for authentication. The implementation creates separate routes for `/sign-in` and `/sign-up` with proper navigation, redirects, and authentication state management.

## Prerequisites

This guide assumes you already have:
- A Next.js application with Supabase authentication configured
- An `Auth` component that handles both sign-in and sign-up functionality
- Authentication utilities in `app/lib/supabase.ts`
- A root layout that manages authentication state

## Implementation Steps

### Step 1: Refactor Auth Component

Update your existing `Auth` component to support being used on dedicated pages with mode control and navigation links.

**File:** `app/components/Auth.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signUp, signIn, signInWithGoogle, getAccessToken } from '../lib/supabase';
import { Form } from '../../components/ui/Form';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import Link from 'next/link';

interface AuthProps {
  initialMode?: 'sign-in' | 'sign-up';
  showToggle?: boolean;
}

export function Auth({ initialMode = 'sign-in', showToggle = true }: AuthProps) {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(initialMode === 'sign-up');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  // Sync isSignUp with initialMode prop changes
  useEffect(() => {
    setIsSignUp(initialMode === 'sign-up');
  }, [initialMode]);

  const handleGoogleSignIn = async () => {
    setError(null);
    setIsLoading(true);
    
    try {
      const { error: googleError } = await signInWithGoogle();
      if (googleError) throw googleError;
      // OAuth redirect will happen automatically
      // The callback route will handle the rest
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed');
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    setSignUpSuccess(false);

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await signUp(email, password);
        if (signUpError) throw signUpError;
        
        // Check if user was immediately signed in (no email confirmation required)
        if (data.session) {
          // User is signed in immediately - sync customer in SolvaPay
          try {
            const accessToken = await getAccessToken();
            if (accessToken) {
              // Call sync-customer endpoint to eagerly create customer
              await fetch('/api/sync-customer', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                },
              }).catch((err) => {
                // Silent failure - don't block signup if customer creation fails
                console.warn('Failed to sync customer after signup:', err);
              });
            }
          } catch (err) {
            // Silent failure - don't block signup if customer creation fails
            console.warn('Failed to sync customer after signup:', err);
          }
          // User is signed in immediately - redirect to home
          router.push('/');
          return;
        } else {
          // Email confirmation required
          setSignUpSuccess(true);
        }
      } else {
        const { error: signInError } = await signIn(email, password);
        if (signInError) throw signInError;
        // Success - redirect to home
        router.push('/');
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen px-4">
      <div className="w-full max-w-md">
        <Form
          title={isSignUp ? 'Create Account' : 'Sign In'}
          description={isSignUp ? 'Create a new account to continue' : 'Sign in to your account'}
        >
          <div className="space-y-4">
            {/* Google Sign-in Button - Top */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-full hover:bg-slate-50 hover:border-slate-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Sign in with Google
            </button>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-slate-500">Or continue with email</span>
              </div>
            </div>

            {/* Email/Password Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="email"
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading}
              />
              <Input
                type="password"
                label="Password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
                minLength={6}
              />
              
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                  {error}
                </div>
              )}

              {signUpSuccess && (
                <div className="text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  Account created! Please check your email to confirm your account, then sign in.
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                isLoading={isLoading}
              >
                {isSignUp ? 'Sign Up' : 'Sign In'}
              </Button>
            </form>

            {showToggle && (
              <div className="text-center">
                {isSignUp ? (
                  <Link
                    href="/sign-in"
                    className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    Already have an account? Sign in
                  </Link>
                ) : (
                  <Link
                    href="/sign-up"
                    className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    Don&apos;t have an account? Sign up
                  </Link>
                )}
              </div>
            )}
          </div>
        </Form>
      </div>
    </div>
  );
}
```

**Key Changes:**
- Added `initialMode` prop to control whether component shows sign-in or sign-up mode
- Added `showToggle` prop to control visibility of navigation links
- Added `useRouter` hook for programmatic navigation after successful authentication
- Replaced toggle button with Next.js `Link` components for navigation between pages
- Added redirect to home page (`/`) after successful sign-in or sign-up

**Action Items:**
- Update your existing `Auth.tsx` component with the above code
- Ensure you have `next/link` imported for navigation links

### Step 2: Create Sign In Page

Create a dedicated page for sign-in at `/sign-in`.

**File:** `app/sign-in/page.tsx`

```typescript
'use client';

import { Auth } from '../components/Auth';

export default function SignInPage() {
  return <Auth initialMode="sign-in" showToggle={true} />;
}
```

**Action Items:**
- Create the `app/sign-in/` directory if it doesn't exist
- Create `page.tsx` with the above code

### Step 3: Create Sign Up Page

Create a dedicated page for sign-up at `/sign-up`.

**File:** `app/sign-up/page.tsx`

```typescript
'use client';

import { Auth } from '../components/Auth';

export default function SignUpPage() {
  return <Auth initialMode="sign-up" showToggle={true} />;
}
```

**Action Items:**
- Create the `app/sign-up/` directory if it doesn't exist
- Create `page.tsx` with the above code

### Step 4: Update Root Layout

Update your root layout to redirect unauthenticated users to the sign-in page instead of rendering the Auth component inline.

**File:** `app/layout.tsx`

```typescript
'use client';

import { SolvaPayProvider } from '@solvapay/react';
import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getOrCreateCustomerId, updateCustomerId } from './lib/customer';
import { getAccessToken, onAuthStateChange } from './lib/supabase';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [customerId, setCustomerId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const userId = await getOrCreateCustomerId();
        setCustomerId(userId);
      } catch (error) {
        console.error('Failed to initialize auth:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  useEffect(() => {
    const authStateChange = onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const userId = session?.user?.id || '';
        setCustomerId(prev => prev !== userId ? userId : prev);
        // Redirect to home if user signs in from auth pages
        if (pathname === '/sign-in' || pathname === '/sign-up') {
          router.push('/');
        }
      } else if (event === 'SIGNED_OUT') {
        setCustomerId('');
      }
    });

    return () => {
      if (authStateChange?.data?.subscription) {
        authStateChange.data.subscription.unsubscribe();
      }
    };
  }, [pathname, router]);

  const handleCustomerRefUpdate = useCallback((newCustomerRef: string) => {
    setCustomerId(newCustomerRef);
    updateCustomerId(newCustomerRef);
  }, []);

  const handleCreatePayment = useCallback(async ({ planRef, customerRef }: { planRef: string; customerRef: string }) => {
    throw new Error('Hosted checkout: Use redirect to app.solvapay.com/checkout instead of createPayment');
  }, []);

  const handleCheckSubscription = useCallback(async (customerRef: string) => {
    const accessToken = await getAccessToken();
    
    const headers: HeadersInit = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const res = await fetch('/api/check-subscription', { headers });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMessage = errorData.error || 'Failed to check subscription';
      throw new Error(errorMessage);
    }
    
    return res.json();
  }, []);

  // Redirect unauthenticated users to sign-in page (except when already on auth pages)
  useEffect(() => {
    if (!isLoading && !customerId && pathname !== '/sign-in' && pathname !== '/sign-up' && pathname !== '/auth/callback') {
      router.push('/sign-in');
    }
  }, [isLoading, customerId, pathname, router]);

  return (
    <html lang="en">
      <body>
        {isLoading ? (
          <div className="flex justify-center items-center min-h-screen">
            <div className="text-slate-600">Initializing...</div>
          </div>
        ) : customerId ? (
          <SolvaPayProvider
            customerRef={customerId}
            onCustomerRefUpdate={handleCustomerRefUpdate}
            createPayment={handleCreatePayment}
            checkSubscription={handleCheckSubscription}
          >
            {children}
          </SolvaPayProvider>
        ) : (
          // Allow auth pages and callback to render
          (pathname === '/sign-in' || pathname === '/sign-up' || pathname === '/auth/callback') ? (
            children
          ) : (
            // Show loading while redirecting
            <div className="flex justify-center items-center min-h-screen">
              <div className="text-slate-600">Redirecting...</div>
            </div>
          )
        )}
      </body>
    </html>
  );
}
```

**Key Changes:**
- Removed inline `Auth` component import and rendering
- Added `useRouter` and `usePathname` hooks from `next/navigation`
- Added redirect logic to send unauthenticated users to `/sign-in` (except on auth pages)
- Added redirect to home page after successful sign-in from auth pages
- Allow auth pages and callback page to render when unauthenticated

**Action Items:**
- Update your `layout.tsx` with the above code
- Ensure you're using Next.js App Router (not Pages Router)

### Step 5: Add Sign Out Functionality (Optional)

Add a sign-out button to your home page so users can sign out.

**File:** `app/page.tsx`

```typescript
'use client';

import { useSubscription, useSubscriptionStatus } from '@solvapay/react';
import { getAccessToken, signOut } from './lib/supabase';
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';

export default function HomePage() {
  const router = useRouter();
  const agentRef = process.env.NEXT_PUBLIC_AGENT_REF;
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { subscriptions, loading, hasActiveSubscription, refetch } = useSubscription();
  const { hasPaidSubscription, activePaidSubscription } = useSubscriptionStatus([]);

  const handleViewPlans = useCallback(async () => {
    // ... existing implementation
  }, [agentRef]);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      router.push('/sign-in');
    } catch (err) {
      console.error('Failed to sign out:', err);
      setIsSigningOut(false);
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-white">
      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-8 flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900 mb-2">Welcome</h1>
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

        {/* ... rest of your page content */}
      </main>
    </div>
  );
}
```

**Key Changes:**
- Added `signOut` import from `./lib/supabase`
- Added `useRouter` hook for navigation
- Added `handleSignOut` callback function
- Added sign-out button in the page header

**Action Items:**
- Update your home page with sign-out functionality
- Adjust button placement and styling to match your design

## Verification Steps

After implementing the changes, verify the following:

1. **Sign In Page:**
   - Navigate to `/sign-in` - should display the sign-in form
   - Should have a link to `/sign-up` at the bottom
   - Should redirect to `/` after successful sign-in

2. **Sign Up Page:**
   - Navigate to `/sign-up` - should display the sign-up form
   - Should have a link to `/sign-in` at the bottom
   - Should redirect to `/` after successful sign-up (if email confirmation is disabled)
   - Should show success message if email confirmation is required

3. **Authentication Flow:**
   - Unauthenticated users visiting `/` should be redirected to `/sign-in`
   - Authenticated users visiting `/sign-in` or `/sign-up` should be redirected to `/`
   - Sign-out should redirect to `/sign-in`

4. **OAuth Flow:**
   - Google sign-in should still work correctly
   - OAuth callback should handle redirects properly

## Common Issues and Solutions

### Issue: Redirect Loop

**Problem:** Users get stuck in a redirect loop between pages.

**Solution:** Ensure your layout correctly checks the pathname before redirecting. Make sure the redirect logic excludes `/sign-in`, `/sign-up`, and `/auth/callback` paths.

### Issue: Auth Component Not Updating Mode

**Problem:** The Auth component doesn't switch between sign-in and sign-up modes when navigating between pages.

**Solution:** Ensure the `initialMode` prop is properly set and the `useEffect` hook is syncing the mode correctly.

### Issue: Sign Out Not Working

**Problem:** Users remain authenticated after clicking sign out.

**Solution:** Verify that the `signOut` function in `lib/supabase.ts` is properly clearing the session. Check browser console for any errors.

### Issue: OAuth Callback Redirects to Wrong Page

**Problem:** After OAuth authentication, users are redirected incorrectly.

**Solution:** Ensure your OAuth callback handler (`/auth/callback`) redirects to `/` after successful authentication. The layout will handle the rest.

## Next Steps

After implementing sign-in and sign-up pages, consider:

1. **Password Reset:** Add a "Forgot Password" link and password reset flow
2. **Email Verification:** Customize the email verification experience
3. **Protected Routes:** Add middleware for additional route protection
4. **User Profile:** Create a user profile page where users can update their information
5. **Social Auth:** Add additional OAuth providers (GitHub, Apple, etc.)

## Summary

You've successfully implemented dedicated sign-in and sign-up pages with:

- Separate routes at `/sign-in` and `/sign-up`
- Proper navigation between auth pages
- Automatic redirects for authenticated/unauthenticated users
- Sign-out functionality
- Preserved OAuth flow
- Clean separation of concerns

The implementation follows Next.js App Router best practices and maintains compatibility with your existing authentication and subscription functionality.

