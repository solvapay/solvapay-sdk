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

Creates a Supabase auth adapter instance. Accepts one of two config shapes:

**`{ client }`** (recommended)

- `config.client` (`SupabaseClient`, required) - Your existing Supabase client.

**`{ supabaseUrl, supabaseAnonKey }`** (deprecated)

- `config.supabaseUrl` (string) - Your Supabase project URL.
- `config.supabaseAnonKey` (string) - Your Supabase anonymous/public key.

The URL/key form dynamically imports `@supabase/supabase-js` and creates a second client. It emits a one-time `console.warn` recommending migration to the `{ client }` form.

**Returns:** `AuthAdapter` instance.

## How It Works

The adapter calls `supabase.auth.getSession()` and returns the access token + user ID. Returns `null` when there is no active session. Never throws.

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
