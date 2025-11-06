[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react-supabase/src](../README.md) / createSupabaseAuthAdapter

# Function: createSupabaseAuthAdapter()

> **createSupabaseAuthAdapter**(`config`): [`AuthAdapter`](../../../react/src/interfaces/AuthAdapter.md)

Defined in: [packages/react-supabase/src/supabase-adapter.ts:62](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react-supabase/src/supabase-adapter.ts#L62)

Create a Supabase authentication adapter for SolvaPayProvider.

This adapter integrates with Supabase Auth to extract user IDs and tokens
from the current Supabase session. It uses Supabase's client-side auth
and dynamically imports @supabase/supabase-js to avoid adding it as a
dependency if Supabase isn't being used.

The adapter caches the Supabase client instance to avoid recreating it
on every call, improving performance.

## Parameters

### config

[`SupabaseAuthAdapterConfig`](../interfaces/SupabaseAuthAdapterConfig.md)

Supabase configuration

## Returns

[`AuthAdapter`](../../../react/src/interfaces/AuthAdapter.md)

AuthAdapter instance compatible with SolvaPayProvider

## Throws

If supabaseUrl or supabaseAnonKey is missing

## Example

```tsx
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase';
import { SolvaPayProvider } from '@solvapay/react';

function App() {
  const adapter = createSupabaseAuthAdapter({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  });

  return (
    <SolvaPayProvider config={{ auth: { adapter } }}>
      <YourApp />
    </SolvaPayProvider>
  );
}
```

## See

 - SolvaPayProvider for using the adapter
 - [AuthAdapter](../../../react/src/interfaces/AuthAdapter.md) for the adapter interface

## Since

1.0.0
