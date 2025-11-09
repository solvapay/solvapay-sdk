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

Use the Supabase adapter with `SolvaPayProvider`:

```tsx
import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'

const adapter = createSupabaseAuthAdapter({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
})

export default function RootLayout({ children }) {
  return <SolvaPayProvider config={{ auth: { adapter } }}>{children}</SolvaPayProvider>
}
```

## API

### `createSupabaseAuthAdapter(config)`

Creates a Supabase auth adapter instance.

**Parameters:**

- `config.supabaseUrl` (string, required) - Your Supabase project URL
- `config.supabaseAnonKey` (string, required) - Your Supabase anonymous/public key

**Returns:** `AuthAdapter` instance

## How It Works

The adapter:

1. Creates a Supabase client using your credentials
2. Gets the current session using `supabase.auth.getSession()`
3. Extracts the access token and user ID from the session
4. Returns `null` if no session is available (unauthenticated)

The adapter handles errors gracefully and never throws - it returns `null` when authentication is not available.

## Example: Full Setup

```tsx
'use client'

import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'

export default function RootLayout({ children }) {
  const adapter = createSupabaseAuthAdapter({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  })

  return (
    <html>
      <body>
        <SolvaPayProvider config={{ auth: { adapter } }}>{children}</SolvaPayProvider>
      </body>
    </html>
  )
}
```

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
