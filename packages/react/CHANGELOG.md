# @solvapay/react changelog

## 1.1.0

### Minor Changes

- ac1fa7f: Lead the MCP account view with the product in focus, then the active
  plan and usage. Mirrors the hosted manage page's information hierarchy
  (`who I am`, `the seller`, `the current product and plan`) without
  forking layout primitives:
  - `<McpAppShell>` threads `bootstrap.product` and `onRefreshBootstrap`
    into `<McpAccountView>` as new `product` and `onRefresh` props.
  - `<McpAccountView>` now opens with a `<header>` painting the product
    name (`<h1>`) and optional description (`<p>`), then a
    `CURRENT PLAN AND USAGE` section label row with an inline refresh
    icon button. Both render unconditionally — even when no purchase or
    credits exist — so the surface always answers "which product am I
    managing?".
  - The standalone "Credit balance" hero card is gone. Its in-card
    pay-as-you-go state lives inside the same plan card as the no-plan
    empty state, with consistent styling and the same `Top up` /
    `See plans` / `Pick a plan` CTAs.
  - `<CurrentPlanCard>` gains `hideHeading`, `hideProductContext`,
    `showStartDate`, and `showReference` props plus matching
    `classNames.startedLine` / `classNames.reference` slots. The MCP
    account view sets all four so the card reads as a card body
    beneath the section label, with `Started {date}` and the
    `pur_…` reference inline. Default behaviour is unchanged for
    hosted callers.
  - New `account.{currentPlanAndUsage, refreshLabel, payAsYouGoTitle,
payAsYouGoBody, noPlanTitle, noPlanBody, seePlansButton,
pickPlanButton}` and `currentPlan.startedOn` copy keys.
  - New `productHeader`, `productName`, `productDescription`,
    `sectionLabelRow`, `sectionLabel`, and `refreshButton` className
    slots on `McpViewClassNames` for theming overrides.

- 08b87f6: Add a "Back to my account" link at the top of the MCP checkout
  view's plan-selector step. Wired by `<McpAppShell>` whenever the
  shell owns surface routing — so customers who reached the plan
  picker by clicking `Pick a plan` / `See plans` on the account
  view can return without losing the iframe. Mirrors the topup
  view's existing back-link pattern.
  - New optional `onBack?: () => void` prop on `<McpCheckoutView>`,
    forwarded through `<EmbeddedCheckout>` and
    `<CheckoutStateMachine>` to `<PlanStep>`.
  - New `checkout.backToAccount` i18n key (default: "Back to my
    account"). The topup view's hard-coded back-link label is left
    alone for now; lifting it into the same key is a follow-up
    cleanup that pulls in the rest of the topup view's strings at
    the same time.

- 92401d3: Add a `<LegalFooter>` primitive that renders a
  `Terms · Privacy / Provided by SolvaPay` strip pointing at SolvaPay's own
  legal pages. Mirrors the hosted-checkout footer without bringing Chakra
  into the SDK.
  - New `legalFooter.{terms, privacy, providedBy, poweredBy}` keys on the
    i18n bundle, overridable via `<SolvaPayProvider config={{ copy }}>`.
  - `<PaymentForm>` and `<TopupForm>` expose a `LegalFooter` namespace
    member so custom compositions can opt into the strip via
    `<PaymentForm.LegalFooter />` / `<TopupForm.LegalFooter />`.
  - The drop-in `<PaymentForm>` default tree does **not** render
    `<LegalFooter />` — the strip is reserved for shell chrome (e.g.
    `<McpAppShell>`) so it isn't duplicated above the merchant's own
    layout.
  - `<MandateText>` now linkifies merchant `termsUrl` / `privacyUrl`
    substrings inside the rendered sentence — they render as `<a>` tags
    labeled via `copy.legalFooter.{terms,privacy}`, so terms/privacy
    access lives at the point of charge alongside the mandate prose.
  - The MCP shell footer (`<McpAppShell>`) renders `<LegalFooter>`
    unconditionally with SolvaPay's legal URLs, laid out as a single
    horizontal row (`Provided by SolvaPay` left, `Terms · Privacy`
    right) with no hairline separator above it.

### Patch Changes

- f655de5: `<LaunchCustomerPortalButton>` (and `<UpdatePaymentMethodButton>` which
  wraps it) now render enabled and labelled from first paint, regardless
  of session state. Multiple instances under the same `<SolvaPayProvider>`
  share a single in-flight `transport.createCustomerSession()` fetch via
  the new internal `useCustomerSessionUrl()` hook, so two buttons on the
  same surface only round-trip once.

  When the URL has resolved, click is a synchronous `<a target="_blank">`
  navigation (which MCP host sandboxes permit). When the user clicks
  before the URL has resolved, the handler awaits the shared in-flight
  promise and falls back to `window.open` (works on hosts that don't
  sandbox scripted opens, e.g. ChatGPT).

  The disabled "Loading…" placeholder is removed. The `loadingClassName`
  and `errorClassName` props are kept for back-compat but now apply only
  as overlay classes during click-time pending / error states — they no
  longer light up under the steady-state cache-hit path.

  The MCP `manage_account` view (`<McpAccountView>`) now passes
  `hideUpdatePaymentButton` to `<CurrentPlanCard>`, so the inline "Update
  card" button no longer renders on that surface. Card updates flow
  through the "Manage billing" customer-portal button instead. The
  `<UpdatePaymentMethodButton>` component itself is unchanged and remains
  exported for non-MCP surfaces.

- 2fa7aec: Three small fixes / UX changes for the MCP "Your plan" card:
  - **Cycle suffix bug fix.** `<CurrentPlanCard>` now falls back to
    `activePurchase.planSnapshot.billingCycle` when the top-level
    `activePurchase.billingCycle` is missing. Recurring plans whose
    cycle was only stamped on the snapshot (e.g. SEK monthly bootstraps)
    previously rendered "SEK 500" instead of "SEK 500 / month".
  - **Single-CTA MCP account view.** `<McpAccountView>` now passes both
    `hideCancelButton` and `hideUpdatePaymentButton` to its embedded
    `<CurrentPlanCard>` and renders a one-line hint underneath
    ("Click Manage account to update your card or cancel your plan.")
    pointing users at the portal CTA below. Inline cancellation inside
    the host iframe was unreliable; until that's root-caused both card
    flows route through the customer portal.
  - **`customerPortal.launchButton` copy renamed** from "Manage billing"
    to "Manage account" to match the broader scope of what the portal
    exposes (card + cancellation + invoices). This is a default localised
    string — integrators that override `customerPortal.launchButton` via
    `<SolvaPayProvider config={{ copy }}>` are unaffected, and consumers
    passing `children` to `<LaunchCustomerPortalButton>` already control
    their own label.

  Also adds a `currentPlan.portalHint` copy key (defaulting to the hint
  above) and renames the same default in `<McpTopupView>`'s post-topup
  success state.

- 0eb9871: `<McpAccountView>` now hides the "Click Manage account to update your card or
  cancel your plan." portal hint whenever the matching `Manage account` button
  itself is hidden. Previously the hint was gated only on `hasPaidPurchase`
  while the button additionally required a non-zero `activePurchase.amount`,
  so a customer on a paid-but-zero-amount purchase would see a hint pointing
  at a CTA that never rendered. The two now share a single gate.
- d4e27df: Remove the inline refresh icon from the `<McpAccountView>` section label
  row. `<McpAppShell>` already re-fetches the bootstrap once on mount, so
  the user-visible button was redundant — re-opening the iframe is the
  only refresh moment that actually matters in practice.
  - `<McpAccountView>` no longer accepts an `onRefresh` prop. The bare
    `CURRENT PLAN AND USAGE` label now sits directly above the plan card.
  - `<McpAppShell>` keeps `onRefreshBootstrap` and the mount-time refresh;
    it just stops threading it into the account view.
  - Removed `sectionLabelRow` and `refreshButton` slots from
    `McpViewClassNames` and the matching `solvapay-mcp-section-label-row`
    / `solvapay-mcp-refresh-button` CSS rules.
  - Removed the `account.refreshLabel` copy key.

- 1d81e43: Three small MCP polish fixes for the host iframe surfaces:
  - **`<McpTopupView>` Pay-with-card step.** Collapsed the duplicated back
    affordance (top `← Back to my account` + bottom `← Change amount`)
    into a single `← Change amount` link at the top of the card. Mirrors
    the pattern already used by the PAYG payment step and removes the
    ambiguity of two competing back buttons on the same surface. The
    amount-picker and success steps keep their `Back to my account` link
    unchanged.
  - **`<McpAccountView>` balance row.** The inline `Top up` button on the
    "Credit balance" card now hugs its label and sits flush right
    instead of stretching across half the row. Achieved with a scoped
    `.solvapay-mcp-balance-row .solvapay-mcp-button { width: auto }`
    override; the same `.solvapay-mcp-button` class keeps its full-width
    default everywhere else (plan picker, topup confirm, portal
    launcher).
  - **`<BackLink>` hover styling.** The hover-state underline used to
    render as two segments with a gap between the arrow and the label
    (the flex `gap` between the glyph and label spans broke the
    underline). Now the underline is scoped to the label span only, so
    it reads as one continuous line — and the arrow gets a subtle 2px
    leftward nudge on hover to reinforce the "back" semantics. Also
    refined `text-underline-offset` / `text-decoration-thickness` so the
    underline sits a touch below the baseline instead of crowding the
    text.

- d4183ba: **PAYG checkout now activates at the plan step.**

  `CheckoutStateMachine` fires `activate_plan` from the plan picker's
  `Continue with Pay as you go` button instead of from the amount picker.
  This pairs with the backend change that makes `activate_plan` eagerly
  create the active usage-based purchase regardless of current credit
  balance — one user-visible click, one activation round-trip.

  Behaviour change:
  - Plan step `Continue` now awaits `activate_plan` before advancing to
    the amount picker. The button renders in its existing activating
    state while the call is in flight; failures surface via
    `activationError` below the button.
  - Amount step `Continue` is now a purely-local state transition — it
    no longer fires `activate_plan`. Back-navigation from the payment
    step (`Change amount`) therefore does not re-activate.
  - `AmountStep` props trimmed: `isActivating` and `activationError`
    removed (unused on this step now). `onContinue` is synchronous.

  Migration notes:
  - Custom surfaces that pass `isActivating` / `activationError` into
    their own `<AmountStep>` wrapper should drop those props.
  - Consumers subclassing `CheckoutStateMachine` should move any logic
    that reacted to "activation-in-flight at the amount step" into the
    plan step's activating window.

  Paired backend PR: `solvapay-backend#112` — eager activation for
  usage-based plans in the `activate_plan` MCP tool handler.

- 2e09385: **`useStripeProbe` now exercises `frame-src`, not just `script-src`.**

  The previous probe only raced `loadStripe()` against a 3s timeout, which
  tests whether Stripe's parent script is allowed to load — i.e.
  `script-src`. That check succeeds on Claude today (the iframe CSP
  permits `https://js.stripe.com/v3/`), so `useStripeProbe` returned
  `'ready'` and `<McpCheckoutView>` / `<McpTopupView>` committed to the
  embedded `PaymentElement` branch. Stripe's `PaymentElement` then tried
  to open its own nested `js.stripe.com` iframes, Claude's
  `frame-src 'self' blob: data:` refused them, and the user saw four
  empty skeleton rows forever:

  ```
  Framing 'https://js.stripe.com/' violates the following Content Security
  Policy directive: "frame-src 'self' blob: data:".
  ```

  The probe now:
  1. Races `loadStripe()` against a ≤3s timeout (unchanged script-src
     check).
  2. Registers a scoped `securitypolicyviolation` listener on
     `document` _before_ mounting. Chrome dispatches this event when it
     refuses the nested `js.stripe.com` iframe; we filter to
     `frame-src` violations with a `stripe.com` `blockedURI` so
     unrelated CSP noise on the host page is ignored. A matching
     violation resolves `'blocked'` immediately.
  3. Mounts a hidden throwaway Payment Element on a visually-hidden
     host node appended to `document.body` and races the element's
     `ready` event against a ≤2s timeout + a `loaderror` listener.
     **`ready` is ignored when a stripe-domain CSP violation has already
     fired** — on Claude, Chrome inserts the iframe but swaps its
     content for a `chrome-error://chromewebdata/` placeholder, which
     Stripe misreads as a successful mount and fires `ready` anyway.
  4. Always tears down the element, removes the host node, and removes
     the CSP listener on resolve, on effect cleanup, and on
     `loaderror`. A cancellation flag guards StrictMode double-invokes.

  Total worst-case budget ≤ 5s. Public return type is unchanged
  (`'loading' | 'ready' | 'blocked'`), so every call site
  (`McpCheckoutView`, `McpTopupView`, their tests) keeps working as-is.
  On Claude the probe now returns `'blocked'` and the views route to
  their hosted-checkout fallbacks instead of hanging on Stripe's internal
  skeletons.

- 86fcee7: Make the committed amount the visual hero of the MCP topup
  pay-with-card step. The amount the customer is about to charge is
  the most useful thing on the screen at that moment, so it sits
  above the form in tabular numerals; the existing balance and the
  credits-added preview drop to a single muted context line beneath
  it. The `<BalanceBadge>` keeps its prominent slot on the
  AmountPicker step and the success step, where balance is the
  right hero. The submit button also gains an explicit `Top up
{amount}` label so the action mirrors the hero.
  - New `topupAmountHero` and `topupBalanceContext` className slots
    on `McpViewClassNames` (default classes
    `solvapay-mcp-topup-amount-hero` / `solvapay-mcp-topup-balance-context`).

- Updated dependencies [7f33787]
  - @solvapay/mcp-core@0.2.1

From `1.0.10` onwards this changelog is generated by
[changesets](https://github.com/changesets/changesets) — prior entries
are maintained by hand and are grouped by the first preview / stable
release that contains them.

## 1.0.10

SEP-1865 text-only-paywall surface trim. Hand-set version (the
Changesets peer-dep cascade would otherwise have forced this to
`2.0.0` because the upstream `@solvapay/mcp-core` minor bump on a
`workspace:*` peer cascades to `major` under Changesets' default
rule). Released as a patch despite the removed public surface
because no external consumers rely on the removed views — they
lived in `@solvapay/react/mcp` behind the preview channel and were
never stabilised. See
`.changeset/hand-set-versions-consolidation.md` for the full
rationale.

### Removed (breaking): MCP paywall / nudge / upsell views

Per SEP-1865 / MCP Apps (2026-01-26) descriptor-advertising means
the host MUST open the iframe on every call. Text-only narrations
live on `content[0].text` now; there's no widget state for the
paywall / nudge / activation surfaces anymore, so the views that
rendered them are removed from the public API:

- `McpPaywallView` + `McpPaywallViewProps`
- `McpNudgeView` + `McpNudgeViewProps`
- `McpUpsellStrip` + `McpUpsellStripProps`
- The matching slots on `McpAppViewOverrides`
  (`paywall` / `nudge` / `upsellStrip`)
- `McpViewKind` narrows to `'checkout' | 'account' | 'topup'`
  (the `'paywall'` and `'nudge'` variants are gone)
- `HostEntryClassification` collapses from the four-way paywall /
  nudge / intent / other split to `'intent' | 'other'`
- `McpBootstrap` loses the `paywall`, `nudge`, and `data` fields —
  the payload the text-only paywall returns no longer carries
  those slots

Migration: drop any imports of `McpPaywallView` / `McpNudgeView` /
`McpUpsellStrip` from your MCP App shell — the paywall narration
surfaces in the LLM's conversation transcript via the paywalled
tool's text response, and no widget mounts for a gate. If you had
custom view overrides for the paywall / nudge slots, delete them;
the compound `<McpApp>` no longer routes through those kinds.

## 1.0.9 — peer-dep rename: `@solvapay/mcp` → `@solvapay/mcp-core`

The optional peer dependency that guards `@solvapay/react/mcp` types was
renamed from `@solvapay/mcp` → `@solvapay/mcp-core` to match the
reshuffled SolvaPay MCP package layout (framework-neutral contracts
now live in `@solvapay/mcp-core`; the official
`@modelcontextprotocol/sdk` adapter is `@solvapay/mcp`). No source
changes — this is a rename of the `peerDependencies` /
`peerDependenciesMeta` contract line only.

Integrators who install the optional peer explicitly:

```diff
- pnpm add @solvapay/mcp
+ pnpm add @solvapay/mcp-core
```

Integrators who don't use `@solvapay/react/mcp` are unaffected.

### `@solvapay/react/mcp` — per-view primitives + `<McpApp>` compound (minor, additive)

The MCP App reference views (`checkout`, `account`, `topup`, `activate`) that
previously lived in `examples/mcp-checkout-app` have been lifted into
`@solvapay/react/mcp` as four composable primitives plus a thin compound
wrapper:

```tsx
import '@solvapay/react/styles.css'
import '@solvapay/react/mcp/styles.css'
import { App } from '@modelcontextprotocol/ext-apps'
import { McpApp } from '@solvapay/react/mcp'

const app = new App({ name: 'my-mcp-app', version: '1.0.0' })
createRoot(rootEl).render(<McpApp app={app} />)
```

Integrators who want a custom shell compose the primitives directly:

```tsx
import {
  McpCheckoutView,
  McpAccountView,
  McpTopupView,
  McpActivateView,
  McpViewRouter,
  fetchMcpBootstrap,
  createMcpFetch,
  createMcpAppAdapter,
  useStripeProbe,
} from '@solvapay/react/mcp'
```

Each view accepts a `classNames?: McpViewClassNames` partial for per-slot
overrides; defaults render the `solvapay-mcp-*` classes from the new
`@solvapay/react/mcp/styles.css` stylesheet. `<McpApp>` also takes a `views`
map for per-screen component overrides without losing routing.

### Seam fixes on primitives that the MCP views needed

Three additive primitive changes landed alongside the lift:

- **`<AmountPicker.Root emit="minor">`** — when set, `onChange` and
  `Confirm.onConfirm` deliver the amount in minor units (respects
  zero-decimal currencies like JPY). Default stays `'major'` for
  back-compat. `useAmountPicker().resolvedAmountMinor` is a new sibling to
  `resolvedAmount` for custom layouts. A new
  `getMinorUnitsPerMajor(currency)` util is exported from
  `@solvapay/react` for integrators doing conversions outside the picker.
- **`<AmountPicker.Root selector={…}>`** — accepts an externally-owned
  `UseTopupAmountSelectorReturn`, letting parent flows share state with
  the inner picker. `ActivationFlow.AmountPicker` now threads the flow's
  selector through this prop, so amounts picked in the sub-picker feed
  straight into `useActivation().retry()` without the old workaround.
- **`<LaunchCustomerPortalButton asChild>`** — renders the ready-state
  anchor via `Slot` so consumers can substitute a real `<button>` inside
  an anchor wrapper (matches the `ActivationFlow.ActivateButton`
  convention). Loading / error fallback buttons are untouched.

All three are additive — no consumer API moves or renames.

### Plans vs balance transactions (minor, behavioural filtering)

Credit top-ups now surface as balance transactions, not plans. `PurchaseInfo`
gains a `metadata?: Record<string, unknown>` field, and two new utilities —
`isPlanPurchase` / `isTopupPurchase` — classify structurally from
`planSnapshot`. The classification is applied inside `usePurchase()` so every
plan-shaped accessor is consistent:

- `activePurchase`, `activePaidPurchase`, `hasPaidPurchase`, `hasProduct`,
  and `cancelledPurchase` / `shouldShowCancelledNotice` (on
  `usePurchaseStatus`) all skip balance transactions.
- A new `balanceTransactions: PurchaseInfo[]` accessor on `usePurchase()`
  returns the complement.
- `purchases` (raw) is unchanged — the full ordering is still available for
  integrators that classify themselves.

`PurchaseInfo.planSnapshot.name` is now surfaced as a first-class field so
`<CurrentPlanCard>` renders a real plan name ("Pro Monthly") instead of the
opaque `planRef`. Legacy purchases without a snapshot name fall back to
`productName`. The `planRef` is retained only as `data-solvapay-current-plan-ref`
on the card root for QA hooks.

`<CurrentPlanCard>` also uses `copy.currentPlan.cycleUnit` to render
"500 kr / month" rather than "500 kr / monthly". Override any of
`weekly` / `monthly` / `quarterly` / `yearly` in your copy bundle to localise
the interval label.

Behavioural note for integrators who previously relied on top-ups surfacing on
`activePurchase`: drop to `purchases` (raw) to restore the old most-recent
ordering, or read from `balanceTransactions` directly.

### BREAKING: Unified `transport` replaces per-method provider overrides

`SolvaPayProvider` now takes a single `config.transport: SolvaPayTransport`
prop. The old per-method `SolvaPayProviderProps` overrides have been removed:

- `checkPurchase`
- `createPayment`
- `processPayment`
- `createTopupPayment`

Consumers passing any of those props must migrate to `config.transport`.

**Before:**

```tsx
<SolvaPayProvider
  checkPurchase={myCheckPurchase}
  createPayment={myCreatePayment}
  processPayment={myProcessPayment}
  createTopupPayment={myCreateTopupPayment}
>
  {children}
</SolvaPayProvider>
```

**After:**

```tsx
const transport: SolvaPayTransport = {
  checkPurchase: myCheckPurchase,
  createPayment: myCreatePayment,
  processPayment: myProcessPayment,
  createTopupPayment: myCreateTopupPayment,
  // ...plus every other required method; see types/transport.ts
}

<SolvaPayProvider config={{ transport }}>{children}</SolvaPayProvider>
```

HTTP consumers who never set those overrides are unaffected — the provider
falls back to `createHttpTransport(config)` automatically.

### Added: `@solvapay/react/mcp` subpath

Ships `createMcpAppAdapter(app)` which returns a `SolvaPayTransport` that
tunnels every data call through `app.callServerTool` instead of HTTP. Use it
when hosting the React tree inside an MCP App, where direct HTTP to your
backend is blocked by the host sandbox:

```tsx
import { createMcpAppAdapter } from '@solvapay/react/mcp'
;<SolvaPayProvider config={{ transport: createMcpAppAdapter(app) }}>{children}</SolvaPayProvider>
```

See the [MCP App integration guide](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)
for the full walkthrough. Re-exports `MCP_TOOL_NAMES` so client and server
share a single source of truth for tool names.

### Added: account management components

- `<CurrentPlanCard>` — plan-type-aware summary card (recurring / one-time /
  usage-based), payment-method display, Update card + Cancel plan actions.
  Returns `null` when there is no active purchase.
- `<LaunchCustomerPortalButton>` — pre-fetches `createCustomerSession` on
  mount and renders a real `<a target="_blank">` anchor (MCP sandbox-safe).
- `<UpdatePaymentMethodButton mode="portal">` — thin wrapper around
  `<LaunchCustomerPortalButton>`. The `mode` prop reserves space for a
  future `"inline"` value without breaking the API.

### Added: `usePaymentMethod` hook

Fetches the customer's default payment method through
`transport.getPaymentMethod()`. Transport-keyed single-flight cache, mirrors
the `useMerchant` pattern. Returns `null` on error (graceful hide, no
`onError` re-emit — the HTTP transport already invokes `config.onError`
before throwing).

### Fixed

- `SolvaPayProvider` no longer flips `loading: true` for polling refetches
  when the customer has no purchases yet. `usePurchase` now exposes a
  separate `isRefetching` flag for background polls; gate initial skeletons
  on `loading` and render subtle refresh indicators on `isRefetching`.
- `LaunchCustomerPortalButton` captures `onError` via ref so parents passing
  an inline arrow no longer re-fire the pre-fetch effect on every render.
- `useMerchant`, `useProduct`, and `usePaymentMethod` no longer double-call
  `config.onError` — the HTTP transport already calls it before throwing.
