# spa-checkout

## What this is

SPA reference for SolvaPay, mirroring the default Lovable stack. Use this as the starting point when pasting SolvaPay into Lovable (or any Vite + React Router SPA scaffolder). The `examples/shadcn-checkout` project is the Next.js equivalent; this one is the non-SSR sibling.

## Stack

- Vite 5 + React 18 + `@vitejs/plugin-react-swc`
- TypeScript 5
- Tailwind v3.4.17 + `autoprefixer` + `postcss`
- shadcn/ui primitives (copy-generated)
- `react-router-dom@^6`
- `@supabase/supabase-js@^2`
- `@solvapay/react` + `@solvapay/react-supabase`
- Backend: [`examples/supabase-edge`](../supabase-edge) — no duplication

## Prereqs

- Node 18+
- Supabase CLI (`brew install supabase/tap/supabase`)
- [`examples/supabase-edge`](../supabase-edge) running locally or deployed

## Local setup

```bash
cd examples/supabase-edge && supabase start && supabase functions serve
cd ../spa-checkout && cp .env.example .env && pnpm install && pnpm dev
```

Populate `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` from `supabase status` output. Vite starts on port `5173`.

## Paste-into-Lovable swap

For local development inside this monorepo we use `workspace:*`. In a standalone project (Lovable, a scratch Vite app, etc.), swap the two SolvaPay packages to the `@preview` dist-tag:

```diff
 "dependencies": {
-  "@solvapay/react": "workspace:*",
-  "@solvapay/react-supabase": "workspace:*",
+  "@solvapay/react": "preview",
+  "@solvapay/react-supabase": "preview",
   "@supabase/supabase-js": "^2",
   ...
 }
```

Set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in Lovable's environment and you're done. See the `lovable-checkout` skill for the end-to-end paste flow.

## Vite env-var rule

Vite only exposes environment variables prefixed with `VITE_` to client code, and they are read through `import.meta.env.VITE_*` — never `process.env`. Keep that in mind when adding new variables: prefix them `VITE_`, reference them through `import.meta.env`, and add a type to `src/vite-env.d.ts`.

## Routing

The one meaningful difference from the App Router examples is the post-payment redirect. Instead of `redirect('/dashboard')` from a server action, React Router exposes `useNavigate()`:

```tsx
import { CheckoutLayout } from '@solvapay/react'
import { useNavigate } from 'react-router-dom'

export function Checkout() {
  const navigate = useNavigate()
  return (
    <CheckoutLayout
      onResult={r => {
        if (r.kind === 'paid' || r.kind === 'activated') navigate('/dashboard')
      }}
    />
  )
}
```

`CheckoutLayout` owns the select → pay | activate state machine; `onResult` fires on both paid and free-plan activations with a discriminated `CheckoutResult`.

## CSS loading order

`src/index.css` imports Tailwind's `@tailwind base/components/utilities` **first**, then `@solvapay/react/styles.css` **last**. That order matters: SolvaPay's rules are unlayered and beat Tailwind preflight when loaded last. Don't flip it.
