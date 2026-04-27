# @solvapay/react-supabase

Supabase authentication adapter for SolvaPay React Provider.

## Installation

```bash
npm install @solvapay/react-supabase @supabase/supabase-js
# or
pnpm add @solvapay/react-supabase @supabase/supabase-js
# or
yarn add @solvapay/react-supabase @supabase/supabase-js
```

## Usage

Pass your existing Supabase client to `createSupabaseAuthAdapter`:

```tsx
import { createClient } from '@supabase/supabase-js'
import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

const adapter = createSupabaseAuthAdapter({ client: supabase })

export default function RootLayout({ children }) {
  return <SolvaPayProvider config={{ auth: { adapter } }}>{children}</SolvaPayProvider>
}
```

Reusing the host app's client avoids spawning a second `GoTrue` instance and is the only reliable form with `@supabase/ssr`, custom `auth.storageKey`, or `persistSession: false`.

## API

### `createSupabaseAuthAdapter(config)`

Creates a Supabase auth adapter instance.

- `config.client` (`SupabaseClient`, required) — your existing Supabase client.

**Returns:** `AuthAdapter` instance.

## How It Works

The adapter calls `supabase.auth.getSession()` to resolve the current access token and user ID, and subscribes to `supabase.auth.onAuthStateChange(...)` so `SolvaPayProvider` reacts immediately to sign-in, sign-out, and token-refresh events without polling. Returns `null` when there is no active session. Never throws.

## Custom Adapters

You can also create custom adapters for other auth providers. See the `AuthAdapter` interface in `@solvapay/react` for the contract.

```tsx
import type { AuthAdapter } from '@solvapay/react';

const myAuthAdapter: AuthAdapter = {
  async getToken() {
    return await myAuthService.getToken();
  },
  async getUserId() {
    return await myAuthService.getUserId();
  },
};

<SolvaPayProvider config={{ auth: { adapter: myAuthAdapter } }}>
```
