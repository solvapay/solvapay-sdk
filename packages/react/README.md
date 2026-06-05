# @solvapay/react

[![npm version](https://img.shields.io/npm/v/@solvapay/react.svg)](https://www.npmjs.com/package/@solvapay/react)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Headless React components and hooks for SolvaPay checkout, plan lifecycle, and MCP App UI.

**When to use this package:** embed checkout or account management in a React app, or render SolvaPay surfaces inside an MCP App iframe.

## Install

```bash
pnpm add @solvapay/react
```

Peer dependencies: `react` and `react-dom` ^18.2.0 || ^19.0.0

Guide: [React integration](https://docs.solvapay.com/sdks/typescript/guides/react)

## Golden path — `<CheckoutLayout>`

One component covers plan selection, payment, free-tier activation, and usage-based top-up:

```tsx
import { SolvaPayProvider, CheckoutLayout } from '@solvapay/react'

export function BuyNow({ email }: { email: string }) {
  return (
    <SolvaPayProvider>
      <CheckoutLayout
        productRef="prd_myapi"
        prefillCustomer={{ email }}
        requireTermsAcceptance
        onResult={result => {
          // result.kind === 'paid' | 'activated'
        }}
      />
    </SolvaPayProvider>
  )
}
```

Pass `planRef` to skip plan selection. Compose slot children on `<PaymentForm>` when you need custom layout — see the [React guide](https://docs.solvapay.com/sdks/typescript/guides/react).

## Supabase auth

```tsx
import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { supabase } from './lib/supabase'

<SolvaPayProvider config={{ auth: { adapter: createSupabaseAuthAdapter({ client: supabase }) } }}>
  <CheckoutLayout productRef="prd_myapi" />
</SolvaPayProvider>
```

For Supabase Edge backends, point `config.api` at `/functions/v1/*` routes — see [Supabase Edge guide](https://docs.solvapay.com/sdks/typescript/guides/supabase-edge).

## Plan lifecycle

Post-purchase components with sensible defaults:

```tsx
import { CancelPlanButton, CancelledPlanNotice, CreditGate, CurrentPlanCard } from '@solvapay/react'

<CurrentPlanCard />
<CancelPlanButton onCancelled={() => refetch()} />
<CancelledPlanNotice onReactivated={() => refetch()} />

<CreditGate minCredits={10}>
  <ExpensiveFeature />
</CreditGate>
```

## MCP App UI

### Recommended — scaffold includes this

For a **new** MCP app, the scaffold ships `@solvapay/react/mcp` wired for you:

```bash
npm create solvapay@latest my-mcp-app -- --type mcp
```

Guide: [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)

### Advanced — existing MCP server

When adding UI to a server you already run, mount `<McpApp>` in your widget bundle:

```tsx
import { createRoot } from 'react-dom/client'
import { App } from '@modelcontextprotocol/ext-apps'
import { McpApp } from '@solvapay/react/mcp'
import '@solvapay/react/styles.css'
import '@solvapay/react/mcp/styles.css'

const app = new App({ name: 'my-mcp-app', version: '1.0.0' })
createRoot(document.getElementById('root')!).render(<McpApp app={app} />)
```

Example: [`examples/mcp-checkout-app`](../../examples/mcp-checkout-app)

For custom shells, compose `McpCheckoutView`, `McpAccountView`, `McpTopupView`, and `createMcpAppAdapter` — full API in the [MCP app guide](https://docs.solvapay.com/sdks/typescript/guides/mcp-app).

## Server-side usage tracking

There is no client `useTrackUsage()` hook — record usage on the server when work actually runs:

```typescript
import { trackUsage } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const result = await doTheExpensiveThing()
  await trackUsage(request, { units: 1 })
  return NextResponse.json(result)
}
```

## Components and hooks reference

Full props, hooks (`usePurchase`, `usePlans`, `useCheckout`, …), and composition patterns:

- [React guide](https://docs.solvapay.com/sdks/typescript/guides/react)
- [MCP app guide](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)

## See also

- [`@solvapay/next`](../next) — Next.js API route helpers
- [`@solvapay/react-supabase`](../react-supabase) — Supabase auth adapter
- [`@solvapay/server`](../server) — paywall and API client
- [`@solvapay/mcp`](../mcp) — MCP server adapter
- [`create-solvapay`](../create-solvapay) — scaffold MCP apps with UI included

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Security**: [Security Policy](https://github.com/solvapay/solvapay-sdk/blob/main/SECURITY.md)
- **Docs**: [docs.solvapay.com/sdks/typescript](https://docs.solvapay.com/sdks/typescript/intro)
