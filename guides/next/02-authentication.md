# Step 2: Authentication Setup

This guide covers setting up Supabase authentication with email/password and Google OAuth support.

## Overview

We'll implement:
1. Supabase client utilities
2. Authentication middleware
3. Sign-in/sign-up pages
4. OAuth callback handler
5. Root layout with auth state management

## Step 1: Create Supabase Client

Create `app/lib/supabase.ts`:

```typescript
/**
 * Supabase Client Setup
 * 
 * Creates and exports the Supabase client for authentication.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not configured. Authentication will not work.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Get the current user's ID from Supabase session
 * Returns null if not authenticated
 */
export async function getUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

/**
 * Get the current user's access token for API calls
 * Returns null if not authenticated
 */
export async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

/**
 * Get the current user's email from Supabase session
 * Returns null if not authenticated
 */
export async function getUserEmail(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.email || null;
}

/**
 * Get the current user object from Supabase session
 * Returns null if not authenticated
 */
export async function getUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user || null;
}

/**
 * Sign up a new user with email and password
 */
export async function signUp(email: string, password: string, name?: string) {
  return await supabase.auth.signUp({
    email,
    password,
    options: name ? {
      data: {
        full_name: name,
      },
    } : undefined,
  });
}

/**
 * Sign in an existing user with email and password
 */
export async function signIn(email: string, password: string) {
  return await supabase.auth.signInWithPassword({
    email,
    password,
  });
}

/**
 * Sign out the current user
 * Properly clears session for both email/password and OAuth providers
 */
export async function signOut() {
  try {
    // Check if there's an active session first
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      // No session to sign out from - return success
      return { data: { user: null }, error: null };
    }
    
    // Sign out from Supabase - clears the local session
    // For OAuth providers, this clears the session cookie
    const result = await supabase.auth.signOut();
    
    if (result.error) {
      // If sign out fails, try to clear local storage anyway
      console.warn('Sign out error (attempting to clear local state):', result.error);
      
      // Force clear local session
      if (typeof window !== 'undefined') {
        // Clear Supabase session storage
        const storageKey = `sb-${supabaseUrl.split('//')[1]?.split('.')[0]}-auth-token`;
        localStorage.removeItem(storageKey);
        sessionStorage.clear();
      }
      
      // Still return success to allow UI to update
      return { data: { user: null }, error: null };
    }
    
    return result;
  } catch (error) {
    // If sign out completely fails, clear local state and return success
    console.warn('Sign out error (clearing local state):', error);
    
    if (typeof window !== 'undefined') {
      // Clear Supabase session storage
      const storageKey = `sb-${supabaseUrl.split('//')[1]?.split('.')[0]}-auth-token`;
      localStorage.removeItem(storageKey);
      sessionStorage.clear();
    }
    
    // Return success to allow UI to update
    return { data: { user: null }, error: null };
  }
}

/**
 * Sign in with Google OAuth
 * Redirects to Google OAuth page, then redirects back to the callback URL
 */
export async function signInWithGoogle() {
  const callbackUrl = `${window.location.origin}/auth/callback`;
  
  return await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl,
    },
  });
}

/**
 * Subscribe to auth state changes
 * Returns an unsubscribe function
 */
export function onAuthStateChange(callback: (event: string, session: any) => void) {
  return supabase.auth.onAuthStateChange(callback);
}
```

## Step 2: Create Customer Management Utility

Create `app/lib/customer.ts`:

```typescript
/**
 * Customer Management Utility
 * 
 * Handles customer ID retrieval from Supabase authentication.
 * In a production app, customer IDs come from your authentication system.
 */

import { getUserId } from './supabase';

/**
 * Get the current user's ID from Supabase session
 * Returns empty string if not authenticated (for React Provider compatibility)
 */
export async function getOrCreateCustomerId(): Promise<string> {
  const userId = await getUserId();
  return userId || '';
}

/**
 * Update customer ID (kept for compatibility, but Supabase handles this)
 * In practice, this is a no-op since userId comes from Supabase session
 */
export function updateCustomerId(_newCustomerId: string): void {
  // No-op: customer ID is managed by Supabase auth
  // This is kept for compatibility with SolvaPayProvider's onCustomerRefUpdate callback
}

/**
 * Clear customer session (sign out)
 * Used for testing purposes or logout functionality
 */
export async function clearCustomerId(): Promise<void> {
  const { supabase } = await import('./supabase');
  await supabase.auth.signOut();
}
```

## Step 3: Create Authentication Middleware

Create `middleware.ts` in the project root:

```typescript
import { createSupabaseAuthMiddleware } from '@solvapay/next';

/**
 * Next.js Middleware for Authentication
 * 
 * Extracts user ID from Supabase JWT tokens and adds it as a header for API routes.
 * This is the recommended approach as it centralizes auth logic and makes it available
 * to all downstream routes.
 */

export const middleware = createSupabaseAuthMiddleware({
  publicRoutes: ['/api/list-plans'], // Add any public routes here
});

export const config = {
  matcher: ['/api/:path*'],
};
```

**What this does:**
- Intercepts all `/api/*` routes
- Extracts user ID from Supabase JWT token in Authorization header
- Sets `x-user-id` header for downstream API routes
- Returns 401 if authentication is required but missing

## Step 4: Update Root Layout

Update `app/layout.tsx`:

```typescript
'use client';

import { SolvaPayProvider } from '@solvapay/react';
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';
import { useState, useEffect, useMemo } from 'react';
import { getOrCreateCustomerId } from './lib/customer';
import { Auth } from './components/Auth';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize auth state
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const userId = await getOrCreateCustomerId();
        setIsAuthenticated(!!userId);
      } catch (error) {
        console.error('Failed to initialize auth:', error);
        setIsAuthenticated(false);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  // Create Supabase auth adapter (only if env vars are available)
  const supabaseAdapter = useMemo(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseAnonKey) {
      return undefined;
    }
    
    return createSupabaseAuthAdapter({
      supabaseUrl,
      supabaseAnonKey,
    });
  }, []);

  return (
    <html lang="en">
      <head>
        <title>My App</title>
        <meta name="description" content="App description" />
      </head>
      <body className="font-sans">
        {isLoading ? (
          // Show loading state while auth is being initialized
          <div className="flex justify-center items-center min-h-screen text-slate-500">
            Initializing...
          </div>
        ) : isAuthenticated ? (
          // Provider with Supabase adapter (if available)
          // The adapter automatically handles subscription checking
          <SolvaPayProvider config={supabaseAdapter ? { auth: { adapter: supabaseAdapter } } : undefined}>
            {children}
          </SolvaPayProvider>
        ) : (
          // Show auth form if not authenticated
          <Auth />
        )}
      </body>
    </html>
  );
}
```

**What this does:**
- Checks authentication status on mount
- Shows loading state while checking
- Renders auth form if not authenticated
- Wraps app in `SolvaPayProvider` with Supabase adapter if authenticated
- **The Supabase adapter automatically handles subscription checking** - no need for a `checkSubscription` prop

**How subscription checking works:**
- The Supabase adapter gets the access token from the Supabase session
- `SolvaPayProvider` automatically calls `/api/check-subscription` with the token
- Subscription state is updated automatically
- You can use `useSubscription()` hook anywhere in your app to access subscription data

## Step 5: Create Auth Component

Create `app/components/Auth.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Form } from './ui/Form';
import { signUp, signIn, signInWithGoogle, getAccessToken } from '../lib/supabase';

export function Auth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

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
        if (!name.trim()) {
          setError('Name is required');
          setIsLoading(false);
          return;
        }
        const { data, error: signUpError } = await signUp(email, password, name);
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
          // User is signed in immediately - auth state change will handle navigation
          setIsLoading(false);
          return;
        } else {
          // Email confirmation required
          setSignUpSuccess(true);
        }
      } else {
        const { error: signInError } = await signIn(email, password);
        if (signInError) throw signInError;
        // Success - auth state change will trigger re-render in layout
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
              {isSignUp && (
                <Input
                  type="text"
                  label="Name"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={isLoading}
                />
              )}
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

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setName('');
                  setError(null);
                  setSignUpSuccess(false);
                }}
                className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
                disabled={isLoading}
              >
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </button>
            </div>
          </div>
        </Form>
      </div>
    </div>
  );
}
```

**Note:** This component uses UI components from `./ui/Button`, `./ui/Input`, and `./ui/Form`. We'll create these in the [Styling Guide](./04-styling.md).

## Step 6: Create OAuth Callback Handler

Create `app/auth/callback/page.tsx`:

```typescript
'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '../../lib/supabase';

/**
 * OAuth Callback Content
 * 
 * Handles the OAuth callback from Supabase after Google sign-in.
 * Supabase automatically exchanges the code for a session when the callback URL is accessed.
 * We verify the session was created, then redirect.
 * The auth state change listener in layout.tsx will handle customer sync.
 */
function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Check for error in URL params
        const error = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');
        
        if (error) {
          console.error('OAuth error:', error, errorDescription);
          // Redirect to home page with error (will show auth form)
          router.push('/');
          return;
        }

        // Supabase automatically exchanges the code for a session when the callback URL is accessed
        // Wait a moment for Supabase to process the callback, then check for session
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Session error:', sessionError);
          router.push('/');
          return;
        }

        if (session) {
          // User is signed in - redirect to home page
          // The auth state change listener in layout.tsx will handle customer sync
          router.push('/');
        } else {
          // No session found - redirect to home page (will show auth form)
          router.push('/');
        }
      } catch (err) {
        console.error('Callback error:', err);
        router.push('/');
      }
    };

    handleCallback();
  }, [router, searchParams]);

  return (
    <div className="flex justify-center items-center min-h-screen px-4">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mx-auto mb-4"></div>
        <p className="text-slate-600">Completing sign in...</p>
      </div>
    </div>
  );
}

/**
 * OAuth Callback Page
 * 
 * Wraps the callback content in Suspense to handle Next.js searchParams
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center items-center min-h-screen px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  );
}
```

## Step 7: Configure Google OAuth (Optional)

To enable Google OAuth sign-in:

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

**Important:** Google sees Supabase's callback URL, NOT your localhost URL. The `redirectTo` option in `signInWithGoogle()` is where Supabase redirects AFTER processing OAuth.

## Verification

Test your authentication setup:

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Test email/password sign-up:**
   - Visit http://localhost:3000
   - Click "Don't have an account? Sign up"
   - Fill in name, email, and password
   - Submit the form
   - If email confirmation is disabled, you should be signed in immediately
   - If email confirmation is required, check your email

3. **Test sign-in:**
   - Sign out (if signed in)
   - Enter email and password
   - Click "Sign In"
   - You should be authenticated

4. **Test Google OAuth (if configured):**
   - Click "Sign in with Google"
   - Complete Google authentication
   - You should be redirected back and signed in

## Troubleshooting

### "SUPABASE_JWT_SECRET environment variable is required"
- Ensure `.env.local` exists with `SUPABASE_JWT_SECRET` set
- Restart dev server after adding environment variables

### "Unauthorized" errors in API routes
- Verify middleware is running (`middleware.ts` exists)
- Check that Authorization header is being sent with requests
- Verify Supabase JWT secret matches your project

### Google OAuth "redirect_uri_mismatch" Error
- Ensure Supabase callback URL is added to Google Cloud Console
- Format: `https://[your-project-ref].supabase.co/auth/v1/callback`
- Add your app callback URL to Supabase Redirect URLs: `http://localhost:3000/auth/callback`

### Auth component not rendering
- Check that UI components exist (`app/components/ui/Button.tsx`, etc.)
- These will be created in the [Styling Guide](./04-styling.md)
- For now, you can create simple placeholder components

## Next Steps

Now that authentication is set up, proceed to:
- **[Step 3: Payments](./03-payments.md)** - Set up SolvaPay hosted checkout

