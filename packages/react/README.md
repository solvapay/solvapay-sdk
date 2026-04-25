# @solvapay/react

Headless React components and hooks for SolvaPay payment integration with Stripe.

## Install

```bash
pnpm add @solvapay/react
```

## Peer Dependencies

- `react` ^18.2.0 || ^19.0.0
- `react-dom` ^18.2.0 || ^19.0.0

## Quick Start

### Zero-Config Usage (Recommended)

```tsx
import { SolvaPayProvider, PaymentForm, usePurchase } from '@solvapay/react'

export default function App() {
  return (
    <SolvaPayProvider>
      <CheckoutPage />
    </SolvaPayProvider>
  )
}
```

By default, `SolvaPayProvider` uses:

- `/api/check-purchase` for purchase checks
- `/api/create-payment-intent` for payment creation
- `/api/process-payment` for payment processing
- `/api/merchant` for merchant identity (`useMerchant`, `MandateText`)
- `/api/get-product` for single-product lookup (`useProduct`, `CheckoutSummary`)

## Golden path — `<CheckoutLayout>` one-liner

`<CheckoutLayout>` handles the full flow: plan selection, payment (paid/free),
and usage-based activation. For 90% of integrations this is the only
component you need.

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

What happens based on what `<CheckoutLayout>` resolves:

| Product shape | Flow |
|---|---|
| One active plan | Auto-skip selection → pay or activate |
| Multiple plans | Styled `<PlanSelector>` → pay or activate |
| Free plan (`requiresPayment: false`) | Skip Stripe entirely → `useActivation` |
| Usage-based plan | `<ActivationFlow>` (summary → top-up → retry → activated) |

Pass `planRef` explicitly to skip the selector and keep today's payment-only
behavior byte-for-byte (backwards compatible with pre-selector integrations).

### Skipping plan selection

```tsx
<CheckoutLayout
  planRef="pln_premium"
  productRef="prd_myapi"
  prefillCustomer={{ email }}
  requireTermsAcceptance
  size="auto"
  onSuccess={() => console.log('paid')}
/>
```

The section below ("Drop-in checkout with `<CheckoutLayout>`") is the original
single-plan form — still supported, still works the same.

## Drop-in checkout with `<CheckoutLayout>`

For a fixed plan checkout (summary, SCA mandate, Stripe PaymentElement,
prefilled customer echo, optional terms checkbox):

```tsx
import { SolvaPayProvider, CheckoutLayout } from '@solvapay/react'

export function BuyNow({ email }: { email: string }) {
  return (
    <SolvaPayProvider>
      <CheckoutLayout
        planRef="pln_premium"
        productRef="prd_myapi"
        prefillCustomer={{ email }}
        requireTermsAcceptance
        size="auto"
        onSuccess={() => console.log('paid')}
      />
    </SolvaPayProvider>
  )
}
```

`size="auto"` uses a `ResizeObserver`, so the same component reflows cleanly
in chat bubbles, phone viewports, and desktop iframes.

## Composition: slot subcomponents

When you need custom layout, compose `<PaymentForm>` with slot children:

```tsx
<PaymentForm planRef="pln_premium" productRef="prd_myapi" prefillCustomer={{ email }}>
  <PaymentForm.Summary />
  <PaymentForm.CustomerFields />
  <PaymentForm.PaymentElement />
  <PaymentForm.MandateText />
  <PaymentForm.TermsCheckbox />
  <PaymentForm.SubmitButton />
</PaymentForm>
```

Passing no children keeps the current default tree for backwards compatibility.

## Localization

English ships by default. Swap the locale (which also flows through to Stripe
Elements) and override any strings you like:

```tsx
import { SolvaPayProvider, CheckoutLayout, type PartialSolvaPayCopy } from '@solvapay/react'

const svSECopy: PartialSolvaPayCopy = {
  cta: { subscribe: 'Prenumerera', processing: 'Bearbetar...' },
  terms: { checkboxLabel: 'Jag godkänner villkoren och integritetspolicyn' },
}

<SolvaPayProvider config={{ locale: 'sv-SE', copy: svSECopy }}>
  <CheckoutLayout planRef="..." productRef="..." />
</SolvaPayProvider>
```

Currency formatting is already locale-correct — `formatPrice` uses
`Intl.NumberFormat` with the provider locale and the plan's `currency` field.

### Custom API Routes

```tsx
import { SolvaPayProvider, PaymentForm } from '@solvapay/react'

export default function App() {
  return (
    <SolvaPayProvider
      config={{
        api: {
          checkPurchase: '/api/custom/purchase',
          createPayment: '/api/custom/payment',
          processPayment: '/api/custom/process',
        },
      }}
    >
      <CheckoutPage />
    </SolvaPayProvider>
  )
}
```

### With Supabase Authentication

```tsx
import { SolvaPayProvider } from '@solvapay/react'
import { createSupabaseAuthAdapter } from '@solvapay/react-supabase'
import { supabase } from './lib/supabase'

export default function App() {
  const adapter = createSupabaseAuthAdapter({ client: supabase })

  return (
    <SolvaPayProvider config={{ auth: { adapter } }}>
      <CheckoutPage />
    </SolvaPayProvider>
  )
}
```

### Fully Custom Implementation

Every data-access call flows through `config.transport`. Build a custom one by
spreading `createHttpTransport(config)` and overriding the methods you need:

```tsx
import { SolvaPayProvider, createHttpTransport } from '@solvapay/react'

export default function App() {
  const transport = {
    ...createHttpTransport(undefined),
    createPayment: async ({ planRef, productRef }) => {
      const res = await fetch('/api/custom/payment', {
        method: 'POST',
        body: JSON.stringify({ planRef, productRef }),
      })
      if (!res.ok) throw new Error('Failed to create payment')
      return res.json()
    },
    checkPurchase: async () => {
      const res = await fetch('/api/custom/purchase')
      if (!res.ok) throw new Error('Failed to check purchase')
      return res.json()
    },
  }

  return (
    <SolvaPayProvider config={{ transport }}>
      <CheckoutPage />
    </SolvaPayProvider>
  )
}
```

### MCP App

For React trees hosted inside an MCP App (where Stripe.js and direct HTTP
to your backend are both blocked by the host sandbox), use the MCP subpath:

```tsx
import { App } from '@modelcontextprotocol/ext-apps'
import { SolvaPayProvider } from '@solvapay/react'
import { createMcpAppAdapter } from '@solvapay/react/mcp'

const app = new App({ name: 'solvapay', version: '1.0.0' })
const transport = createMcpAppAdapter(app)

export default function Root() {
  return (
    <SolvaPayProvider config={{ transport }}>
      <CheckoutPage />
    </SolvaPayProvider>
  )
}
```

The MCP server is expected to expose tools whose names match `MCP_TOOL_NAMES`
from `@solvapay/react/mcp` — each transport method maps 1:1 to a tool call.

### Managing plans in an MCP App

Once a customer is paid, drop `<CurrentPlanCard />` into the UI and the
SDK does the rest — plan name, price, next-billing / expiry line,
payment-method summary (via `get_payment_method`), Update-card and
Cancel-plan actions. The card returns `null` when there's no active
purchase, so you can render it unconditionally:

```tsx
import { CurrentPlanCard } from '@solvapay/react'

function Account() {
  return <CurrentPlanCard />
}
```

Behind the scenes:

- Plan metadata comes from `usePurchase` (provider state, no extra fetch)
- Payment-method line comes from `usePaymentMethod` → `transport.getPaymentMethod()`
- `<UpdatePaymentMethodButton>` pre-fetches `transport.createCustomerSession()`
  on mount and renders a real `<a target="_blank">` to the hosted portal —
  MCP host sandboxes permit direct anchor clicks even though scripted
  `window.open` after an async round-trip is blocked.
- `<CancelPlanButton>` reuses Phase 1 behaviour — no new plumbing.

If you want the bare portal-launch button on its own (e.g. in a top nav),
use `<LaunchCustomerPortalButton />` directly.

> `<PlanSwitcher>` (plan upgrade/downgrade with proration) and
> `<PaymentMethodForm>` (inline Stripe Elements card update) are deferred
> to follow-up PRs — see the plan in the SDK repo for scope. For plan
> changes today, MCP apps use `<CancelPlanButton>` + `<CurrentPlanCard>`
> + a fresh hosted checkout flow.

## Building MCP Apps

`@solvapay/react/mcp` ships a turnkey compound plus four composable
primitives for SolvaPay MCP Apps built on
[`@modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps).

### Quick start — `<McpApp>`

```tsx
import { createRoot } from 'react-dom/client'
import { App } from '@modelcontextprotocol/ext-apps'
import { McpApp } from '@solvapay/react/mcp'
import '@solvapay/react/styles.css'
import '@solvapay/react/mcp/styles.css'

const app = new App({ name: 'my-mcp-app', version: '1.0.0' })
createRoot(document.getElementById('root')!).render(<McpApp app={app} />)
```

`<McpApp>` handles `app.connect()`, calls the `open_*` tool matching the
host's invocation context, mounts `<SolvaPayProvider>` with
`createMcpAppAdapter(app)` + `createMcpFetch(transport)`, and routes to the
correct per-view primitive.

Pass `applyContext` to wire host theme / fonts / safe-area insets from the
`ext-apps` helpers, override individual screens via `views`, and tweak
per-slot styling via `classNames`:

```tsx
<McpApp
  app={app}
  applyContext={ctx => {
    if (ctx?.theme) applyDocumentTheme(ctx.theme)
  }}
  views={{
    account: MyCustomAccountScreen, // optional — one-off override
  }}
  classNames={{ card: 'my-card', button: 'my-btn' }}
  onInitError={err => console.error('[mcp]', err)}
/>
```

See [`examples/mcp-checkout-app`](../../examples/mcp-checkout-app) for the
full host integration including the server-side `open_*` tool + UI resource
registration.

### Per-view primitives

When you need a custom shell — your own provider mount, additional routes,
a bespoke layout — compose the pieces directly:

```tsx
import {
  AppHeader,
  createMcpAppAdapter,
  createMcpFetch,
  fetchMcpBootstrap,
  McpCheckoutView,
  McpAccountView,
  McpTopupView,
  McpViewRouter,
  useStripeProbe,
} from '@solvapay/react/mcp'
```

Every view accepts a `classNames?: McpViewClassNames` partial. Props are
typed per-view (`McpCheckoutViewProps`, `McpAccountViewProps`,
`McpTopupViewProps`). The previous `McpPaywallView` / `McpNudgeView`
/ `McpUpsellStrip` surfaces were removed with the text-only paywall
refactor — merchant paywall / nudge responses narrate in
`content[0].text` and don't open the widget iframe.

### `<AppHeader>` — host-aware merchant strip

Every built-in view renders `<AppHeader />` at its surface root: a
compact `[icon] Merchant-Name` row at the top of the card. When you
compose your own view (via `<McpViewRouter>` or `<SolvaPayProvider>`
directly) drop it in as the first child to keep branding consistent.

```tsx
import { AppHeader } from '@solvapay/react/mcp'

function MyView() {
  return (
    <div className="solvapay-mcp-card">
      <AppHeader />
      <h2>Your custom step</h2>
      {/* ... */}
    </div>
  )
}
```

`<AppHeader>` is **host-aware**. In `mode="auto"` (the default) it
suppresses itself on hosts that already paint a merchant mark in their
chrome:

- **ChatGPT**, whose [Apps SDK UI guidelines](https://developers.openai.com/apps-sdk/concepts/ui-guidelines)
  explicitly prohibit in-widget logos (*"ChatGPT will always append
  your logo and app name before the widget is rendered."*).
- **Claude Desktop**, which paints its own MCP app chrome strip (app
  icon + app name + active tool name) above every widget iframe — a
  second in-widget merchant row stacks on top of it.

On MCP Jam, VS Code, and other hosts that leave in-widget branding to
the app, `<AppHeader>` paints the strip so the user always sees who
they're dealing with.

```tsx
<AppHeader mode="auto" />    // default — host-aware
<AppHeader mode="always" />  // force render (e.g. testing)
<AppHeader mode="never" />   // force hide (e.g. custom chrome)
```

Use `classNames={{ appHeader, appHeaderIcon, appHeaderInitials, appHeaderName }}`
to restyle any slot, or pass `children` for inline content on the
right side (e.g. a close affordance or status chip). The merchant is
read from `useMerchant()` automatically.

Integrators building entirely custom shells can also read the raw host
name via `useHostName()`:

```tsx
import { useHostName, HOSTS_WITH_MERCHANT_CHROME } from '@solvapay/react/mcp'

const hostName = useHostName() // 'ChatGPT' | 'Claude Desktop' | 'MCP Jam' | null
const showMark = !hostName || !HOSTS_WITH_MERCHANT_CHROME.test(hostName)
```

### Architecture ADR

See [`docs/mcp-app-architecture.md`](./docs/mcp-app-architecture.md) for the
hybrid-API decision record and the three primitive seam fixes
(`AmountPicker emit="minor"` / `selector={…}`, `LaunchCustomerPortalButton asChild`)
that landed with this lift.

## Components

### SolvaPayProvider

Headless context provider that manages purchase state, payment methods, and customer references.

**Features:**

- Zero-config with sensible defaults
- Auto-fetches purchases on mount
- Built-in localStorage caching with user validation
- Supports auth adapters for extracting user IDs and tokens
- Customizable API routes via config

**Props:**

- `config?: SolvaPayConfig` - Configuration object (optional)
  - `config.api?` - Custom API route paths
  - `config.auth?` - Auth adapter configuration
- `createPayment?: (params: { planRef: string; productRef?: string }) => Promise<PaymentIntentResult>` - Custom payment creation function (optional, overrides config)
- `checkPurchase?: (customerRef: string) => Promise<CustomerPurchaseData>` - Custom purchase check function (optional, overrides config)
- `processPayment?: (params: { paymentIntentId: string; productRef: string; planRef?: string }) => Promise<ProcessPaymentResult>` - Custom payment processing function (optional)
- `children: React.ReactNode` - Child components

**Config Options:**

```tsx
interface SolvaPayConfig {
  api?: {
    checkPurchase?: string // Default: '/api/check-purchase'
    createPayment?: string // Default: '/api/create-payment-intent'
    processPayment?: string // Default: '/api/process-payment'
  }
  auth?: {
    adapter?: AuthAdapter // Auth adapter for extracting user ID/token
    getToken?: () => Promise<string | null> // Deprecated: use adapter
    getUserId?: () => Promise<string | null> // Deprecated: use adapter
  }
}
```

### PricingSelector

Component for selecting and displaying available pricing options.

**Props:**

- `productRef?: string` - Product reference to filter pricing options
- `fetcher?: (productRef: string) => Promise<Plan[]>` - Custom fetcher function
- `onPlanSelect?: (plan: Plan) => void` - Callback when option is selected
- `renderPlan?: (plan: Plan) => React.ReactNode` - Custom option renderer
- `className?: string` - Container className

**Example:**

```tsx
import { PricingSelector, usePlans } from '@solvapay/react'

function PricingPage() {
  const { plans, loading } = usePlans({ productRef: 'my-product' })

  return (
    <div>
      {loading ? 'Loading...' : plans.map(plan => <div key={plan.reference}>{plan.price}/{plan.interval}</div>)}
    </div>
  )
}
```

### PaymentForm

Payment form component using Stripe PaymentElement. Automatically handles Stripe Elements provider setup.

**Props:**

- `planRef: string` - Plan reference for the payment
- `productRef?: string` - Optional product reference
- `onSuccess?: (paymentIntent: PaymentIntent) => void` - Callback on successful payment
- `onError?: (error: Error) => void` - Callback on payment error
- `returnUrl?: string` - Return URL after payment
- `submitButtonText?: string` - Submit button text (default: "Pay Now")
- `formClassName?: string` - Form element className
- `messageClassName?: string` - Message container className
- `buttonClassName?: string` - Submit button className

**Example:**

```tsx
import { PaymentForm } from '@solvapay/react'

function CheckoutPage() {
  return (
    <PaymentForm
      planRef="pln_YOUR_PLAN"
      productRef="prd_YOUR_PRODUCT"
      onSuccess={() => console.log('Payment successful!')}
    />
  )
}
```

### ProductBadge

Displays current product subscription with render props or className pattern.

**Props:**

- `children?: (props) => React.ReactNode` - Render prop function
- `as?: React.ElementType` - Component to render (default: "div")
- `className?: string | ((props) => string)` - ClassName or function

**Example:**

```tsx
<ProductBadge className="badge badge-primary" />
```

### PurchaseGate

Controls access to content based on purchase status.

**Props:**

- `requireProduct?: string` - Optional product name to check for an active purchase
- `children: (props) => React.ReactNode` - Render prop function

**Example:**

```tsx
<PurchaseGate requireProduct="Pro Plan">
  {({ hasAccess, loading, purchases }) => {
    if (loading) return <Loading />
    if (!hasAccess) return <Paywall />
    return <PremiumContent />
  }}
</PurchaseGate>
```

## Hooks

### usePurchase

Access purchase status, active purchases, and helper functions.

```tsx
const {
  purchases, // Array of all purchases (raw — plans + balance transactions)
  balanceTransactions, // Credit top-ups and other non-plan rows
  loading, // Loading state
  hasPaidPurchase, // Boolean: has any paid plan purchase
  activePurchase, // Most recent active plan purchase
  refetch, // Function to refetch purchases
} = usePurchase()
```

#### Plans vs balance

Plans and balance credits are orthogonal. A customer can hold at most one
active plan and any number of balance transactions (credit top-ups today; gift
credits, referral bonuses, refunds tomorrow).

Every plan-shaped accessor — `activePurchase`, `activePaidPurchase`,
`hasPaidPurchase`, `hasProduct`, plus `cancelledPurchase` /
`shouldShowCancelledNotice` on `usePurchaseStatus` — filters out balance
transactions. Top-ups surface on `balanceTransactions`, and the aggregate
credit balance on `useBalance()`.

Classification is structural (`isPlanPurchase` / `isTopupPurchase`): a purchase
with no `planSnapshot` was never a plan. `metadata.purpose === 'credit_topup'`
acts as a defense-in-depth guard.

```tsx
import { isPlanPurchase, isTopupPurchase } from '@solvapay/react'

const plans = purchases.filter(isPlanPurchase)
const topups = purchases.filter(isTopupPurchase)
```

If you previously relied on top-ups surfacing on `activePurchase` (e.g. "show
the most recent transaction"), read from `purchases` or `balanceTransactions`
directly.

### usePlans

Fetch and manage available plans.

```tsx
const {
  plans, // Array of available plans
  loading, // Loading state
  error, // Error object if fetch failed
  refetch, // Function to refetch plans
} = usePlans({
  productRef: 'my-product', // Optional product reference
  fetcher: customFetcher, // Optional custom fetcher function
})
```

### usePurchaseStatus

Advanced purchase status helpers.

```tsx
const {
  cancelledPurchase, // Most recent cancelled purchase
  shouldShowCancelledNotice, // Boolean: should show cancellation notice
  formatDate, // Helper to format dates
  getDaysUntilExpiration, // Helper to get days until expiration
} = usePurchaseStatus()
```

### useCheckout

Manage checkout flow for a specific plan.

```tsx
const { loading, error, startCheckout, reset } = useCheckout('plan_ref')
```

### useSolvaPay

Access SolvaPay context directly.

```tsx
const {
  purchaseData, // Full purchase data
  loading, // Loading state
  createPayment, // Payment creation function
  processPayment, // Payment processing function
  customerRef, // Current customer reference
  updateCustomerRef, // Function to update customer reference
} = useSolvaPay()
```

## TypeScript

All components and hooks are fully typed. Import types as needed:

```tsx
import type {
  PaymentFormProps,
  PurchaseStatus,
  PaymentIntentResult,
  CheckoutResult,
  PaymentResult,
  ActivationResult,
} from '@solvapay/react'
```

## Plan lifecycle

Beyond checkout itself, three thin styled-default components cover the
post-purchase experience without requiring custom UI.

### `<CancelPlanButton>`

Wraps `usePurchaseActions.cancelRenewal` with a built-in confirm dialog,
loading state, and plan-type-aware copy (subscription vs usage-based).
Auto-reads the active purchase from `usePurchase()`.

```tsx
import { CancelPlanButton } from '@solvapay/react'

<CancelPlanButton onCancelled={() => router.push('/')} />
```

Use `confirm={false}` for a single-click cancel, or pass a string to override
the default copy. The render-prop form exposes `{ cancel, isCancelling,
disabled, purchase }` for fully custom UI.

### `<CancelledPlanNotice>`

Surfaces automatically when the customer has a cancelled-but-still-active
purchase. Renders the expiration date, days remaining, cancellation reason,
and a reactivate CTA. Renders nothing when there's nothing to show.

```tsx
import { CancelledPlanNotice } from '@solvapay/react'

<CancelledPlanNotice onReactivated={() => refetch()} />
```

### `<CreditGate>`

Companion to `<PurchaseGate>` for usage-based flows. Blocks access when the
customer's credit balance falls below a threshold; renders an embedded
`<TopupForm>` by default.

```tsx
import { CreditGate } from '@solvapay/react'

<CreditGate minCredits={10}>
  <ExpensiveFeature />
</CreditGate>
```

Customize via the `fallback` prop, or use the render-prop form
(`children: ({ balance, hasCredits, topup }) => …`) for fully custom UI.

## Server-side usage tracking

There is intentionally no `useTrackUsage()` client hook. Client-reported usage
is trivially gamed — a user can simply block the fetch to conserve credits.
Instead, record usage from your server when the expensive work actually runs:

```ts
// app/api/do-thing/route.ts
import { trackUsage } from '@solvapay/next'

export async function POST(request: NextRequest) {
  const result = await doTheExpensiveThing()
  await trackUsage(request, { units: 1 })
  return NextResponse.json(result)
}
```

The same pattern works from a Supabase Edge Function — see below.

## Using with Supabase Edge Functions

Lovable-style apps deploy React frontends against Supabase Edge Functions
(Deno runtime). The SDK's `api` URL overrides let the exact same
`<CheckoutLayout>` drop-in work against `/functions/v1/*` routes:

```tsx
<SolvaPayProvider
  config={{
    api: {
      checkPurchase: `${SUPABASE_URL}/functions/v1/check-purchase`,
      createPayment: `${SUPABASE_URL}/functions/v1/create-payment-intent`,
      processPayment: `${SUPABASE_URL}/functions/v1/process-payment`,
      listPlans: `${SUPABASE_URL}/functions/v1/list-plans`,
      getMerchant: `${SUPABASE_URL}/functions/v1/get-merchant`,
      getProduct: `${SUPABASE_URL}/functions/v1/get-product`,
      // …same pattern for every other endpoint
    },
    auth: {
      adapter: createSupabaseAuthAdapter({ client: supabase }),
    },
  }}
>
  <CheckoutLayout
    productRef="prd_myapi"
    prefillCustomer={{ email }}
    requireTermsAcceptance
  />
</SolvaPayProvider>
```

The matching Deno edge functions ship in
[`@solvapay/fetch`](../../packages/fetch) — see
[`examples/supabase-edge`](../../examples/supabase-edge) for one-liner
`Deno.serve(handler)` files covering every handler including the new
`get-merchant` and `get-product` endpoints.

## More Information

See [`docs/contributing/architecture.md`](../../docs/contributing/architecture.md) for contributor
architecture documentation.
