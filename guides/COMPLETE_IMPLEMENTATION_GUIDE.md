# Complete Implementation Guide: Next.js App with SolvaPay Subscriptions and Modern Styling

## Overview

This comprehensive guide provides step-by-step instructions for building a complete Next.js React application with:
- **Authentication** using Supabase
- **Subscription functionality** using SolvaPay (hosted checkout pattern)
- **Modern UI components** and styling with Tailwind CSS

The implementation follows a hosted checkout pattern where users are redirected to SolvaPay's hosted checkout page, and includes a complete design system with reusable components.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Setup](#project-setup)
3. [Styling Configuration](#styling-configuration)
4. [Component Library](#component-library)
5. [Authentication Setup](#authentication-setup)
6. [Subscription Implementation](#subscription-implementation)
7. [Pages and Components](#pages-and-components)
8. [Common UI Patterns](#common-ui-patterns)
9. [Verification Steps](#verification-steps)
10. [Common Issues and Solutions](#common-issues-and-solutions)
11. [Next Steps](#next-steps)

## Prerequisites

### Required Accounts

1. **SolvaPay Account**
   - Sign up at https://solvapay.com
   - Get your secret API key from the dashboard
   - Create at least one agent and plan in your dashboard

2. **Supabase Account**
   - Sign up at https://supabase.com
   - Create a new project
   - Get your project URL and anon key from Settings → API
   - Get your JWT secret from Settings → API → JWT Secret

## Project Setup

### Step 1: Initialize Next.js Project

Create a new Next.js project if you haven't already:

```bash
npx create-next-app@latest my-app --typescript --tailwind --app
cd my-app
```

### Step 2: Install Dependencies

Install all required packages:

```bash
npm install @solvapay/auth@preview @solvapay/server@preview @solvapay/next@preview @solvapay/react@preview @supabase/supabase-js next react react-dom
```

**Note:** Always use the `@preview` tag when installing SolvaPay packages to ensure you get the latest preview versions.

### Step 3: Install Dev Dependencies for Styling

```bash
npm install -D @types/node @types/react @types/react-dom autoprefixer postcss tailwindcss typescript
```

### Step 4: Environment Variables Setup

Create a `.env.local` file in your project root with the following variables:

```env
# SolvaPay Configuration
SOLVAPAY_SECRET_KEY=sp_sandbox_your_secret_key_here
SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com
NEXT_PUBLIC_AGENT_REF=agt_your_agent_ref

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_JWT_SECRET=your_supabase_jwt_secret_here
```

**Action Items:**
- Copy `.env.local` from `env.example` (if exists)
- Fill in all required values from your SolvaPay and Supabase dashboards
- **OAuth Setup:** If using Google OAuth, ensure it's configured in Supabase:
  - Go to Supabase Dashboard → Authentication → Providers → Google
  - Enable Google provider and configure your Google OAuth credentials
  - Add your redirect URL: `http://localhost:3000/auth/callback` (for development) and `https://your-domain.com/auth/callback` (for production)

## Styling Configuration

### Step 1: Tailwind CSS Configuration

Create `tailwind.config.ts`:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        emerald: {
          100: '#d1fae5',
          200: '#a7f3d0',
          700: '#047857',
        },
        blue: {
          100: '#dbeafe',
          200: '#bfdbfe',
          400: '#60a5fa',
          700: '#1d4ed8',
        },
        purple: {
          100: '#f3e8ff',
          200: '#e9d5ff',
          400: '#a78bfa',
          700: '#7c3aed',
        },
        red: {
          100: '#fee2e2',
          400: '#f87171',
          700: '#b91c1c',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out forwards',
        'slide-up': 'slide-up 0.6s ease-out forwards',
        'slide-down': 'slide-down 0.6s ease-out forwards',
        'scale-in': 'scale-in 0.4s ease-out forwards',
      },
      keyframes: {
        'fade-in': {
          'from': { opacity: '0' },
          'to': { opacity: '1' },
        },
        'slide-up': {
          'from': { opacity: '0', transform: 'translateY(20px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          'from': { opacity: '0', transform: 'translateY(-20px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          'from': { opacity: '0', transform: 'scale(0.9)' },
          'to': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

### Step 2: PostCSS Configuration

Create `postcss.config.js`:

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

### Step 3: Global Styles

Create `app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Minimal styling */
html, body {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  background-color: white;
  color: #0f172a;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
}

/* Smooth transitions */
* {
  transition-property: color, background-color, border-color;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}

/* Focus states */
button:focus-visible,
input:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}
```

## Component Library

Create the following UI components in `components/ui/`:

### Button Component

Create `components/ui/Button.tsx`:

```typescript
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'icon';
  children: React.ReactNode;
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  children,
  className = '',
  isLoading = false,
  disabled,
  ...props
}) => {
  const baseClasses = 'font-medium transition-all duration-200 focus:outline-none focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2';
  
  const variantClasses = {
    primary: 'px-4 py-2.5 text-sm text-white bg-slate-900 rounded-full hover:bg-slate-800 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed',
    secondary: 'px-4 py-2 text-xs text-slate-600 bg-transparent rounded-full hover:text-slate-900 hover:bg-slate-50',
    icon: 'p-1.5 text-slate-400 bg-transparent rounded-lg hover:text-slate-700 hover:bg-slate-50',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${className} ${isLoading ? 'flex items-center justify-center' : ''}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <svg className="animate-spin mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Processing...</span>
        </>
      ) : (
        children
      )}
    </button>
  );
};
```

### Card Component

Create `components/ui/Card.tsx`:

```typescript
import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'glass';
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  variant = 'default',
  style,
}) => {
  const baseClasses = 'rounded-2xl shadow-xl border border-slate-200/60';
  
  const variantClasses = {
    default: 'bg-white',
    glass: 'bg-white/95 backdrop-blur-lg',
  };

  return (
    <div className={`${baseClasses} ${variantClasses[variant]} ${className}`} style={style}>
      {children}
    </div>
  );
};
```

### Badge Component

Create `components/ui/Badge.tsx`:

```typescript
import React from 'react';

type BadgeVariant = 'premium' | 'free' | 'credits' | 'daypass';

interface BadgeProps {
  children: React.ReactNode;
  variant: BadgeVariant;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant,
  className = '',
}) => {
  const variantClasses = {
    premium: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    free: 'bg-slate-100 text-slate-600 border-slate-200',
    credits: 'bg-blue-100 text-blue-700 border-blue-200',
    daypass: 'bg-purple-100 text-purple-700 border-purple-200',
  };

  return (
    <span
      className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
};
```

### Input Component

Create `components/ui/Input.tsx`:

```typescript
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  icon,
  className = '',
  ...props
}) => {
  const inputClasses = `block w-full px-3 py-2 bg-white border rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-300 transition-colors ${
    error ? 'border-red-400 focus:ring-red-200' : 'border-slate-200/60'
  } ${icon ? 'pr-12' : ''} ${className}`;

  return (
    <div>
      {label && (
        <label className="block text-xs font-medium text-slate-700 mb-1">
          {label}
        </label>
      )}
      <div className="relative">
        <input className={inputClasses} {...props} />
        {icon && (
          <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
            {icon}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-700">{error}</p>
      )}
    </div>
  );
};
```

### Form Component

Create `components/ui/Form.tsx`:

```typescript
import React from 'react';

interface FormProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  className?: string;
}

export const Form: React.FC<FormProps> = ({
  children,
  title,
  description,
  className = '',
}) => {
  return (
    <div className={`bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200/60 p-5 ${className}`}>
      {title && (
        <h2 className="text-lg font-semibold text-slate-900 mb-1">{title}</h2>
      )}
      {description && (
        <p className="text-sm text-slate-600 mb-4">{description}</p>
      )}
      {children}
    </div>
  );
};
```

### FormField Component

Create `components/ui/FormField.tsx`:

```typescript
import React from 'react';
import { Input } from './Input';

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  icon?: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  error,
  icon,
  className = '',
  ...props
}) => {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}
      </label>
      <Input
        label="" // Don't duplicate label
        error={error}
        icon={icon}
        className={className}
        {...props}
      />
    </div>
  );
};
```

## Authentication Setup

### Step 1: Create Supabase Client Utility

Create `app/lib/supabase.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not configured.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function getUserId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
}

export async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

export async function getUserEmail(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.email || null;
}

export async function signUp(email: string, password: string) {
  return await supabase.auth.signUp({ email, password });
}

export async function signIn(email: string, password: string) {
  return await supabase.auth.signInWithPassword({ email, password });
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
 * Note: Assumes Google OAuth is already configured in your Supabase project
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

export function onAuthStateChange(callback: (event: string, session: any) => void) {
  return supabase.auth.onAuthStateChange(callback);
}
```

**Action Items:**
- Create the `app/lib` directory if it doesn't exist
- Create `supabase.ts` with the above code
- **Note:** Ensure Google OAuth is configured in your Supabase project dashboard (Authentication → Providers → Google)

### Step 2: Create Customer Management Utility

Create `app/lib/customer.ts`:

```typescript
import { getUserId } from './supabase';

export async function getOrCreateCustomerId(): Promise<string> {
  const userId = await getUserId();
  return userId || '';
}

export function updateCustomerId(_newCustomerId: string): void {
  // No-op: customer ID is managed by Supabase auth
}

export async function clearCustomerId(): Promise<void> {
  const { supabase } = await import('./supabase');
  await supabase.auth.signOut();
}
```

**Action Items:**
- Create `customer.ts` in `app/lib/`

### Step 3: Setup Authentication Middleware

Create `middleware.ts` in the project root:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

let auth: SupabaseAuthAdapter | null = null;

function getAuthAdapter(): SupabaseAuthAdapter {
  if (!auth) {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('SUPABASE_JWT_SECRET environment variable is required.');
    }
    auth = new SupabaseAuthAdapter({ jwtSecret });
  }
  return auth;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  const publicRoutes: string[] = [];
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

  let authAdapter: SupabaseAuthAdapter;
  try {
    authAdapter = getAuthAdapter();
  } catch (error) {
    return NextResponse.json(
      { error: 'Server configuration error', details: error instanceof Error ? error.message : 'Authentication not configured' },
      { status: 500 }
    );
  }

  const userId = await authAdapter.getUserIdFromRequest(request);

  if (isPublicRoute) {
    const requestHeaders = new Headers(request.headers);
    if (userId) {
      requestHeaders.set('x-user-id', userId);
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (!userId) {
    return NextResponse.json(
      { error: 'Unauthorized', details: 'Valid authentication required' },
      { status: 401 }
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', userId);
  
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/api/:path*'],
};
```

**Action Items:**
- Create `middleware.ts` in the project root
- Ensure `SUPABASE_JWT_SECRET` is set in `.env.local`

## Subscription Implementation

### Step 1: Create Check Subscription API Route

Create `app/api/check-subscription/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { checkSubscription } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  
  if (result instanceof NextResponse) {
    return result;
  }
  
  return NextResponse.json(result);
}
```

**Action Items:**
- Create `app/api/check-subscription/` directory
- Create `route.ts` with the above code

### Step 2: Create Checkout Session API Route

Create `app/api/create-checkout-session/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';
import { getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';

let authAdapter: SupabaseAuthAdapter | null = null;

function getAuthAdapter(): SupabaseAuthAdapter {
  if (!authAdapter) {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('SUPABASE_JWT_SECRET environment variable is required.');
    }
    authAdapter = new SupabaseAuthAdapter({ jwtSecret });
  }
  return authAdapter;
}

export async function POST(request: NextRequest) {
  try {
    // Try to get userId from x-user-id header first (set by middleware)
    let userId = request.headers.get('x-user-id');
    
    // If not in header, try to extract from request using auth adapter
    if (!userId) {
      try {
        const adapter = getAuthAdapter();
        userId = await adapter.getUserIdFromRequest(request);
      } catch (error) {
        console.error('[Route] Failed to get userId from auth adapter:', error);
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', details: 'User ID not found. Ensure middleware is configured.' },
        { status: 401 }
      );
    }

    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    const { planRef, agentRef } = await request.json();

    if (!agentRef) {
      return NextResponse.json(
        { error: 'Missing required parameter: agentRef is required' },
        { status: 400 }
      );
    }

    const solvaPay = createSolvaPay();

    const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    const session = await solvaPay.createCheckoutSession({
      agentRef,
      customerRef: ensuredCustomerRef,
      planRef: planRef || undefined,
    });

    return NextResponse.json({
      checkoutSessionId: session.sessionId,
      checkoutUrl: session.checkoutUrl,
    });

  } catch (error) {
    console.error('Checkout session creation failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Checkout session creation failed', details: errorMessage },
      { status: 500 }
    );
  }
}
```

**Action Items:**
- Create `app/api/create-checkout-session/` directory
- Create `route.ts` with the above code
- **Note:** This route uses `SupabaseAuthAdapter` directly to check `x-user-id` header first (set by middleware), then falls back to extracting userId from the Authorization header if needed

### Step 3: Create Sync Customer API Route (Optional)

Create `app/api/sync-customer/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';
import { getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';

let authAdapter: SupabaseAuthAdapter | null = null;

function getAuthAdapter(): SupabaseAuthAdapter {
  if (!authAdapter) {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('SUPABASE_JWT_SECRET environment variable is required.');
    }
    authAdapter = new SupabaseAuthAdapter({ jwtSecret });
  }
  return authAdapter;
}

export async function POST(request: NextRequest) {
  try {
    // Try to get userId from x-user-id header first (set by middleware)
    let userId = request.headers.get('x-user-id');
    
    // If not in header, try to extract from request using auth adapter
    if (!userId) {
      try {
        const adapter = getAuthAdapter();
        userId = await adapter.getUserIdFromRequest(request);
      } catch (error) {
        console.error('[Route] Failed to get userId from auth adapter:', error);
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', details: 'User ID not found. Ensure middleware is configured.' },
        { status: 401 }
      );
    }

    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    const solvaPay = createSolvaPay();

    const customerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    return NextResponse.json({ customerRef, success: true });
  } catch (error) {
    console.error('Sync customer failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to sync customer', details: errorMessage },
      { status: 500 }
    );
  }
}
```

**Action Items:**
- Create `app/api/sync-customer/` directory
- Create `route.ts` with the above code
- **Note:** This route uses the same authentication pattern as the checkout route for consistency

### Step 4: Create Customer Session API Route

Create `app/api/create-customer-session/route.ts` for managing customer portal sessions:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createSolvaPay } from '@solvapay/server';
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';
import { getUserEmailFromRequest, getUserNameFromRequest } from '@solvapay/auth';

let authAdapter: SupabaseAuthAdapter | null = null;

function getAuthAdapter(): SupabaseAuthAdapter {
  if (!authAdapter) {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('SUPABASE_JWT_SECRET environment variable is required.');
    }
    authAdapter = new SupabaseAuthAdapter({ jwtSecret });
  }
  return authAdapter;
}

export async function POST(request: NextRequest) {
  try {
    // Log headers for debugging
    const xUserIdHeader = request.headers.get('x-user-id');
 
    // Try to get userId from x-user-id header first (set by middleware)
    let userId = xUserIdHeader;
    
    // If not in header, try to extract from request using auth adapter
    if (!userId) {
      try {
        const adapter = getAuthAdapter();
        userId = await adapter.getUserIdFromRequest(request);
        console.log('[Route] Extracted userId from request using auth adapter:', userId || 'none');
      } catch (error) {
        console.error('[Route] Failed to get userId from auth adapter:', error);
      }
    }

    if (!userId) {
      console.log('[Route] No userId found, returning 401');
      return NextResponse.json(
        { error: 'Unauthorized', details: 'User ID not found. Ensure middleware is configured.' },
        { status: 401 }
      );
    }

    console.log('[Route] Successfully extracted userId:', userId);

    const email = await getUserEmailFromRequest(request);
    const name = await getUserNameFromRequest(request);

    const solvaPay = createSolvaPay();

    const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
      email: email || undefined,
      name: name || undefined,
    });

    const session = await solvaPay.createCustomerSession({
      customerRef: ensuredCustomerRef,
    });

    return NextResponse.json({
      customerUrl: session.customerUrl,
    });

  } catch (error) {
    console.error('Customer session creation failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Customer session creation failed', details: errorMessage },
      { status: 500 }
    );
  }
}
```

**Action Items:**
- Create `app/api/create-customer-session/` directory
- Create `route.ts` with the above code
- **Note:** This route uses `createCustomerSession()` from the SolvaPay SDK to create a customer portal session, which allows customers to manage their subscriptions, update payment methods, and view billing history

### Step 5: Setup Root Layout with SolvaPayProvider

Update `app/layout.tsx` to redirect unauthenticated users to sign-in page:

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
- Update `app/layout.tsx` with the provider setup and redirect logic
- Ensure all imports are correct
- Ensure you're using Next.js App Router (not Pages Router)

## Pages and Components

### Step 1: Create Authentication Component

Create `app/components/Auth.tsx` with support for dedicated sign-in and sign-up pages:

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
- Create `app/components/` directory if needed
- Create `Auth.tsx` with the above code
- Ensure you have `next/link` imported for navigation links
- **Note:** The Google OAuth button requires Google OAuth to be configured in your Supabase project dashboard

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

### Step 4: Create OAuth Callback Page

Create `app/auth/callback/page.tsx` to handle OAuth redirects from Google:

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

**Action Items:**
- Create `app/auth/callback/` directory
- Create `page.tsx` with the above code
- **Note:** This callback URL (`/auth/callback`) must match the redirect URL configured in your Supabase project settings

### Step 6: Create Home Page with Subscription Check and Management

Update `app/page.tsx`:

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
  const [isManagingAccount, setIsManagingAccount] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { loading } = useSubscription();
  const { hasPaidSubscription, activePaidSubscription } = useSubscriptionStatus([]);

  const handleViewPlans = useCallback(async () => {
    if (!agentRef) return;

    setIsRedirecting(true);
    try {
      const accessToken = await getAccessToken();
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers,
        body: JSON.stringify({ agentRef }),
      });

      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }

      const { checkoutUrl } = await response.json();
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
      }
    } catch (err) {
      console.error('Failed to redirect to checkout:', err);
      setIsRedirecting(false);
    }
  }, [agentRef]);

  const handleManageAccount = useCallback(async () => {
    setIsManagingAccount(true);
    try {
      const accessToken = await getAccessToken();
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch('/api/create-customer-session', {
        method: 'POST',
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to create customer session');
      }

      const { customerUrl } = await response.json();
      if (customerUrl) {
        window.location.href = customerUrl;
      }
    } catch (err) {
      console.error('Failed to redirect to customer portal:', err);
      setIsManagingAccount(false);
    }
  }, []);

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

        {loading ? (
          <Card className="p-8">
            <div className="text-slate-600">Loading subscription...</div>
          </Card>
        ) : hasPaidSubscription ? (
          <Card className="p-8">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-xl font-semibold text-slate-900">Subscription Active</h2>
              <Badge variant="premium">Premium</Badge>
            </div>
            <div className="space-y-3 mb-6">
              <p className="text-slate-600">
                You&apos;re currently subscribed to the <span className="font-medium text-slate-900">{activePaidSubscription?.planName}</span> plan.
              </p>
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                <p className="text-sm text-emerald-900 font-medium">✓ Premium content unlocked!</p>
                <p className="text-xs text-emerald-700 mt-1">
                  You have full access to all premium features with your active subscription.
                </p>
              </div>
            </div>
            <Button onClick={handleManageAccount} disabled={isManagingAccount} className="w-full sm:w-auto">
              {isManagingAccount ? 'Redirecting...' : 'Manage Account'}
            </Button>
          </Card>
        ) : (
          <Card className="p-8">
            <h2 className="text-xl font-semibold text-slate-900 mb-4">No Active Subscription</h2>
            <p className="text-slate-600 mb-6">
              You don&apos;t have an active subscription. Upgrade to unlock premium features.
            </p>
            <Button onClick={handleViewPlans} disabled={isRedirecting} className="w-full sm:w-auto">
              {isRedirecting ? 'Redirecting...' : 'Upgrade'}
            </Button>
          </Card>
        )}
      </main>
    </div>
  );
}
```

**Key Changes:**
- Changed button text from "View Plans" to "Upgrade" when no subscription exists
- Added "Manage Account" button that appears when `hasPaidSubscription` is true
- Added `handleManageAccount` callback that creates a customer portal session and redirects to the customer portal
- Enhanced subscription status card with more detailed information about the active subscription
- Added `isManagingAccount` state to track the loading state of the manage account action
- Improved content messaging to better reflect subscription status

**Action Items:**
- Update `app/page.tsx` with subscription checking logic, sign-out functionality, and account management
- Ensure the "Upgrade" button shows when no subscription is active
- Ensure the "Manage Account" button shows when subscription is active
- Verify the customer portal session API route is created (Step 4)

## Common UI Patterns

### Error Messages

```typescript
{error && (
  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
    {error}
  </div>
)}
```

### Success Messages

```typescript
<div className="text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
  Success message
</div>
```

### Warning Messages

```typescript
<div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
  <p className="text-sm font-medium text-amber-900">
    Warning message
  </p>
</div>
```

### Loading States

```typescript
// Skeleton loader
const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse bg-slate-200 rounded ${className}`} />
);

<Skeleton className="h-5 w-48" />
```

### Navigation Bar

```typescript
<nav className="bg-white border-b border-slate-100 sticky top-0 z-50">
  <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
    <div className="flex justify-between items-center h-14">
      <Link href="/" className="text-lg font-medium text-slate-900 no-underline hover:text-slate-700 transition-colors">
        Your App
      </Link>
      {/* Navigation items */}
    </div>
  </div>
</nav>
```

### Feature Cards Grid

```typescript
<div className="grid md:grid-cols-2 gap-4">
  <div className="p-6 rounded-xl border border-slate-200 bg-white">
    <h3 className="text-lg font-medium mb-2 text-slate-900">
      Feature Title
    </h3>
    <p className="text-sm text-slate-600">
      Feature description
    </p>
  </div>
</div>
```

### Divider with Text

```typescript
<div className="relative">
  <div className="absolute inset-0 flex items-center">
    <div className="w-full border-t border-slate-200"></div>
  </div>
  <div className="relative flex justify-center text-sm">
    <span className="px-2 bg-white text-slate-500">Or continue with email</span>
  </div>
</div>
```

## Design Principles

1. **Color Palette**: Primarily uses slate grays with accent colors (emerald, blue, purple, red) for status indicators
2. **Border Radius**: 
   - Small elements: `rounded-lg` (8px)
   - Medium elements: `rounded-xl` (12px)
   - Large elements: `rounded-2xl` (16px)
   - Buttons: `rounded-full` (pill shape)
3. **Shadows**: Subtle shadows (`shadow-sm`, `shadow-xl`) for depth
4. **Transitions**: Smooth 150ms transitions for interactive elements
5. **Spacing**: Consistent spacing using Tailwind's scale (4px base unit)
6. **Typography**: System font stack with medium weight for headings, regular for body text
7. **Focus States**: Blue outline (`#3b82f6`) with 2px width and offset

## Component File Structure

```
components/
  ui/
    Button.tsx
    Card.tsx
    Badge.tsx
    Input.tsx
    Form.tsx
    FormField.tsx
app/
  components/
    Auth.tsx
  sign-in/
    page.tsx
  sign-up/
    page.tsx
  auth/
    callback/
      page.tsx
  lib/
    supabase.ts
    customer.ts
  api/
    check-subscription/
      route.ts
    create-checkout-session/
      route.ts
    create-customer-session/
      route.ts
    sync-customer/
      route.ts
  page.tsx
  layout.tsx
  globals.css
middleware.ts
tailwind.config.ts
postcss.config.js
```

## Verification Steps

1. **Test Sign In Page:**
   - Start dev server: `npm run dev`
   - Navigate to `/sign-in` - should display the sign-in form
   - Should have a link to `/sign-up` at the bottom
   - Sign in with email/password
   - Verify you're redirected to `/` after successful sign-in

2. **Test Sign Up Page:**
   - Navigate to `/sign-up` - should display the sign-up form
   - Should have a link to `/sign-in` at the bottom
   - Sign up with email/password
   - Verify you're redirected to `/` after successful sign-up (if email confirmation is disabled)
   - Verify email confirmation message appears if email confirmation is required

3. **Test Authentication Redirects:**
   - Unauthenticated users visiting `/` should be redirected to `/sign-in`
   - Authenticated users visiting `/sign-in` or `/sign-up` should be redirected to `/`
   - Sign-out should redirect to `/sign-in`

4. **Test Google OAuth:**
   - Click "Sign in with Google" button
   - Verify redirect to Google OAuth page
   - Complete Google authentication
   - Verify redirect back to `/auth/callback`
   - Verify redirect to home page after successful authentication
   - Verify user is signed in

5. **Test Subscription Check:**
   - After signing in, check browser console for subscription API calls
   - Verify subscription status displays correctly

6. **Test Checkout Flow:**
   - Click "Upgrade" button (when no subscription)
   - Verify redirect to SolvaPay hosted checkout
   - Complete test payment (use card: 4242 4242 4242 4242)
   - Verify redirect back to app
   - Verify subscription status updates
   - Verify "Manage Account" button appears after subscription is active

7. **Test Customer Portal (Manage Account):**
   - With an active subscription, click "Manage Account" button
   - Verify redirect to customer portal session URL
   - Verify you can manage subscription, payment methods, and billing history in the portal
   - Verify redirect back to app after managing account

## Common Issues and Solutions

### Issue: "Missing SUPABASE_JWT_SECRET"

**Solution:** Ensure `.env.local` has `SUPABASE_JWT_SECRET` set correctly

### Issue: "Unauthorized" errors

**Solution:**
- Verify middleware is running (`middleware.ts` exists)
- Check that Authorization header is being sent with requests
- Verify Supabase JWT secret matches your project
- **Important:** The API routes check `x-user-id` header first (set by middleware), then fall back to extracting userId from the Authorization header. Ensure middleware is properly setting the `x-user-id` header.

### Issue: Subscription not updating after checkout

**Solution:**
- Call `refetch()` after returning from checkout
- Check that `/api/check-subscription` returns correct format
- Verify customerRef matches between checkout and subscription check

### Issue: Customer not found errors

**Solution:**
- Ensure `sync-customer` API route is called after signup
- Verify `ensureCustomer` is being called with correct userId

### Issue: Google OAuth not working

**Solution:**
- Verify Google OAuth is enabled in Supabase Dashboard → Authentication → Providers → Google
- Check that redirect URL is configured correctly in Supabase:
  - Development: `http://localhost:3000/auth/callback`
  - Production: `https://your-domain.com/auth/callback`
- Ensure the callback URL matches exactly (including protocol and port)
- Check browser console for OAuth errors
- Verify Google OAuth credentials are correct in Supabase

### Issue: Redirect Loop

**Problem:** Users get stuck in a redirect loop between pages.

**Solution:** Ensure your layout correctly checks the pathname before redirecting. Make sure the redirect logic excludes `/sign-in`, `/sign-up`, and `/auth/callback` paths.

### Issue: Auth Component Not Updating Mode

**Problem:** The Auth component doesn't switch between sign-in and sign-up modes when navigating between pages.

**Solution:** Ensure the `initialMode` prop is properly set and the `useEffect` hook is syncing the mode correctly.

### Issue: Sign Out Not Working

**Problem:** Users remain authenticated after clicking sign out.

**Solution:** Verify that the `signOut` function in `lib/supabase.ts` is properly clearing the session. Check browser console for any errors.

### Issue: Installing older package versions

**Problem:** When running `npm install` without tags, npm uses the `latest` tag which may point to older preview versions.

**Solution:**
- Always use the `@preview` tag when installing: `npm install @solvapay/auth@preview @solvapay/server@preview @solvapay/next@preview @solvapay/react@preview`

### Issue: Tailwind styles not applying

**Solution:**
- Verify `tailwind.config.ts` includes all content paths
- Ensure `globals.css` is imported in `layout.tsx`
- Check that PostCSS is configured correctly
- Restart the dev server after configuration changes

## Next Steps

- ✅ Subscription management UI (Manage Account button implemented)
- Implement content gating with `SubscriptionGate` component
- Add plan badge to navigation
- Set up webhooks for subscription events
- Add subscription status to user profile
- Customize colors and spacing to match your brand
- Extend components as needed for your specific use cases

## Additional Resources

- SolvaPay Documentation: https://docs.solvapay.com
- Supabase Auth Documentation: https://supabase.com/docs/guides/auth
- Next.js Documentation: https://nextjs.org/docs
- Tailwind CSS Documentation: https://tailwindcss.com/docs

---

This guide provides a complete foundation for building a Next.js application with authentication, subscriptions, and modern styling. The design system provides a clean, modern aesthetic that can be easily customized while maintaining consistency across your application.
