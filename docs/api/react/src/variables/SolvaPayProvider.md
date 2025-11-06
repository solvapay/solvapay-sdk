[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / SolvaPayProvider

# Variable: SolvaPayProvider

> `const` **SolvaPayProvider**: `React.FC`\<[`SolvaPayProviderProps`](../interfaces/SolvaPayProviderProps.md)\>

Defined in: [packages/react/src/SolvaPayProvider.tsx:194](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/SolvaPayProvider.tsx#L194)

SolvaPay Provider - Headless Context Provider for React.

Provides subscription state, payment methods, and customer data to child components
via React Context. This is the root component that must wrap your app to use
SolvaPay React hooks and components.

Features:
- Automatic subscription status checking
- Customer reference caching in localStorage
- Payment intent creation and processing
- Authentication adapter support (Supabase, custom, etc.)
- Zero-config with sensible defaults, or full customization

## Param

Provider configuration

## Param

Configuration object for API routes and authentication

## Param

API route configuration (optional, uses defaults if not provided)

## Param

Endpoint for checking subscription status (default: '/api/check-subscription')

## Param

Endpoint for creating payment intents (default: '/api/create-payment-intent')

## Param

Endpoint for processing payments (default: '/api/process-payment')

## Param

Authentication configuration (optional)

## Param

Auth adapter for extracting user ID and token

## Param

React children components

## Example

```tsx
import { SolvaPayProvider } from '@solvapay/react';

// Zero config (uses defaults)
function App() {
  return (
    <SolvaPayProvider>
      <YourApp />
    </SolvaPayProvider>
  );
}

// Custom API routes
function App() {
  return (
    <SolvaPayProvider
      config={{
        api: {
          checkSubscription: '/custom/api/subscription',
          createPayment: '/custom/api/payment'
        }
      }}
    >
      <YourApp />
    </SolvaPayProvider>
  );
}

// With Supabase auth adapter
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';

function App() {
  const adapter = createSupabaseAuthAdapter({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  });

  return (
    <SolvaPayProvider
      config={{
        auth: { adapter }
      }}
    >
      <YourApp />
    </SolvaPayProvider>
  );
}
```

## See

 - [useSubscription](../functions/useSubscription.md) for accessing subscription data
 - [useCheckout](../functions/useCheckout.md) for payment checkout flow
 - [useSolvaPay](../functions/useSolvaPay.md) for accessing provider methods

## Since

1.0.0
