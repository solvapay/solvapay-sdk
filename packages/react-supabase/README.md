# @solvapay/react-supabase

[![npm version](https://img.shields.io/npm/v/@solvapay/react-supabase.svg)](https://www.npmjs.com/package/@solvapay/react-supabase)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Supabase authentication adapter for `SolvaPayProvider` — session tokens and user IDs without a second GoTrue instance.

**When to use this package:** your React app already uses Supabase Auth and you want `@solvapay/react` checkout to send authenticated requests.

## Install

```bash
pnpm add @solvapay/react-supabase @supabase/supabase-js
```

Guides: [React](https://docs.solvapay.com/sdks/typescript/guides/react) · [Supabase Edge](https://docs.solvapay.com/sdks/typescript/guides/supabase-edge)

## Quickstart

Pass your existing Supabase client:

```tsx
import { createClient } from '@supabase/supabase-js'
import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export default function RootLayout({ children }) {
  return (
    <SolvaPayProvider
      config={{ auth: { adapter: createSupabaseAuthAdapter({ client: supabase }) } }}
    >
      {children}
    </SolvaPayProvider>
  )
}
```

Reusing the host app's client is required for `@supabase/ssr`, custom `auth.storageKey`, or `persistSession: false`.

## How it works

Calls `supabase.auth.getSession()` for the current token and user ID. Subscribes to `onAuthStateChange` so `SolvaPayProvider` reacts to sign-in, sign-out, and refresh without polling. Returns `null` when there is no session. Never throws.

## See also

- [`@solvapay/react`](../react) — checkout UI and hooks
- [`@solvapay/auth`](../auth) — server-side Supabase JWT adapter
- [`@solvapay/server/fetch`](../server) — Supabase Edge Function handlers
- [Supabase Edge example](../../examples/typescript/supabase-edge)

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Docs**: [docs.solvapay.com/sdks/typescript/guides/supabase-edge](https://docs.solvapay.com/sdks/typescript/guides/supabase-edge)
