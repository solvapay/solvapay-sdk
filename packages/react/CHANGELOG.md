# @solvapay/react changelog

## 1.2.1

### Patch Changes

- Updated dependencies [254498f]
  - @solvapay/mcp-core@0.2.5

## 1.2.0

### Minor Changes

- b53abcb: Add step-aware heading + subheading primitives to `<CheckoutSteps>`. `<CheckoutSteps.StepHeading>` and `<CheckoutSteps.StepMessage>` resolve copy from the active `flow.step` and `flow.branch` (and the selected plan's `billingCycle`), so the chrome at the top of the embedded checkout updates as the customer progresses through plan -> amount -> payment. New `checkout.stepHeading.{plan,amount,payment}` and `checkout.stepMessage.{plan,amount,paymentRecurring,paymentOneTime,paymentPayg}` keys ship with sensible English defaults; the `paymentRecurring` key interpolates `{planName}` from the selected plan.

  ```tsx
  <CheckoutSteps.Root productRef={productRef} returnUrl={url}>
    <CheckoutSteps.StepHeading className="my-heading" />
    <CheckoutSteps.StepMessage className="my-subheading" />
    <CheckoutSteps.IfStep step="plan">{/* … */}</CheckoutSteps.IfStep>
    {/* … */}
  </CheckoutSteps.Root>
  ```

  When nested inside `<PaywallNotice.Root>`, the `plan` step heading + message defer to the existing `paywall.{paymentRequired,activationRequired,topupRequired}Heading` / `resolvePaywallMessage` so the gate-reason framing the customer saw on entry stays intact. Outside paywall context the fallback `checkout.stepHeading.plan` ("Choose your plan") is used.

  `<PaywallNotice.EmbeddedCheckout>` now renders `<CheckoutSteps.StepHeading>` + `<CheckoutSteps.StepMessage>` at the top of its internal stepped composition by default, passing through the consumer's `classNames.heading` / `classNames.message` overrides. Integrators who already render `<PaywallNotice.Heading>` + `<PaywallNotice.Message>` as siblings of `<EmbeddedCheckout>` (the previous documented pattern) will see duplicated text — drop the outer parts and rely on the in-flow defaults, or stop using `<PaywallNotice.EmbeddedCheckout>` and compose `<CheckoutSteps.*>` directly to keep full layout control.

  Resolves the stale "Pick a plan below to keep chatting." subheading shown on the lifetime-access checkout once the user had progressed past the plan step, and the equivalent staleness on the proactive upgrade path in the chat-checkout demo.

- f0ee414: Add first-class chatbot / streaming primitives across `@solvapay/server` and `@solvapay/react`.

  ### `@solvapay/server`
  - **New `solvaPay.payable({ productRef }).gate(req, opts)` primitive.** Decision-shaped paywall surface for streaming, SSE, and multi-step agent flows that don't fit the one-shot `.http()` / `.next()` / `.mcp()` adapter contract. Returns a discriminated union — `{ kind: 'paywall', response, content }` (pre-built 402) or `{ kind: 'allow', decision, customerRef, trackSuccess, trackFail }` with bound usage closures. `trackSuccess` / `trackFail` pre-fill `productRef`, `customerRef`, `requestId` and route through `ctx.waitUntil` when an `ExecutionContext`-shaped `ctx` is provided so Workers keep `trackUsage` alive past the response close. Multiple `trackSuccess` calls per allow decision are supported (per-step metering for AI SDK `onStepFinish`, LangChain `handleLLMEnd`, OpenAI `response.completed`).
  - **New `solvaPay.paywall.decide()` factory exposure.** The kernel `paywall.decide()` routine — already used internally by adapters — is now reachable on the public factory return so streaming handlers can consume the verdict directly without re-implementing limit checks + gate construction.
  - **New `buildPaywallGate(productRef, limits)` export.** Pure helper that converts a `LimitResponseWithPlan` (or any subset compatible with `apiClient.checkLimits`) into a `PaywallStructuredContent`. Extracted from `paywall.decide()`; both paths share the helper so wire shapes stay in lockstep. Exported from both `./` and `./edge` entrypoints.
  - **New types:** `PayableGateOptions`, `PayableGateResult`, `PayablePaywallResult`, `PayableAllowResult`.
  - The handler-shaped adapters (`.http`, `.next`, `.mcp`, `.function`) and `paywall.protect()` are unchanged.

  ### `@solvapay/react`
  - **`usePlans({ productRef })` `fetcher` is now optional.** When omitted, the hook reads `_config` via `SolvaPayContext` and routes through `defaultListPlans` — preferring `config.transport.listPlans` when available, falling back to `GET ${config.api.listPlans ?? '/api/list-plans'}`. Matches the existing fallback in `<PlanSelector>` / `<CheckoutLayout>` so consumers no longer need to hand-roll `useTransport()` + a fetcher just to call `usePlans`. Explicit `fetcher` overrides remain supported for advanced cases.
  - **New anonymous-auth helpers (`./adapters/auth`):**
    - `getOrCreateAnonymousCustomerRef(storageKey?)` — mints / persists an `anon_<uuid>` customer ref under `localStorage`. Falls back to the deterministic `'anon_ssr'` placeholder server-side.
    - `createAnonymousAuthAdapter(customerRef)` — returns an `AuthAdapter` whose `getToken()` and `getUserId()` both yield the supplied ref. Used to keep the SDK's auth-poll heuristic happy in apps without real authentication.
    - `resetAnonymousCustomerRef(storageKey?)` — clears the persisted ref plus the SDK's cached customer-ref entries so the next call mints a fresh identity.

  These are additive — no existing exports change. `chat-checkout-demo` is now built on `payable.gate()` + `<PaywallNotice>` and demonstrates the JWT real-auth migration in its README.

- b53abcb: Make every checkout entry require a deliberate plan click + Continue, and ship baseline CSS for the `solvapay-checkout-*` namespace so the recommended-default paywall and `<CheckoutSteps.*>` surfaces look correct out of the box.

  ### Behavioural changes
  - **`usePlans` no longer pre-selects the first plan when auto-selection is opted out.** When `autoSelectFirstPaid: false` and no `initialPlanRef` is supplied (the configuration `<CheckoutSteps.Root>` uses), `selectedPlanIndex` is `-1` and `selectedPlan` is `null` until the user picks a card. Previously the hook fell through to `0`, which silently highlighted the first card and enabled `<CheckoutSteps.PlanContinueButton>` — defeating the explicit-consent intent of `autoSelectFirstPaid: false`. `<PlanSelector.Root>` direct consumers default to `autoSelectFirstPaid: true` and are unaffected.
  - **`<PaywallNotice.EmbeddedCheckout>` and `<CheckoutSteps.*>` always render the plan step.** The user clicks a card and presses Continue; nothing auto-advances. This applies even when only one plan is selectable — the plan step is where the rate / commitment is disclosed, and consenting to a paid action shouldn't be silent.
  - **`@solvapay/react/styles.css` ships baseline rules for `solvapay-checkout-*` parts** — continue button, back link, order summary, amount picker, success receipt. Apps overriding the per-part `className` are unaffected; apps relying on no styling will see new defaults. The pay button (`.solvapay-checkout-pay-button`) and form errors (`.solvapay-checkout-error`) are deliberately not styled here — the underlying `<PaymentForm>` / `<TopupForm>` primitives already cover them via `[data-solvapay-*-submit]` and `[data-solvapay-*-error]`.

  ### Additions
  - **`UseCheckoutFlowReturn.canGoBack`** — derived boolean read by `<CheckoutSteps.BackLink>`. With every progression user-driven, `canGoBack` is `true` whenever `step` is `'amount'` or `'payment'`, and `false` on `'plan'`.

- e83cae5: Allow customers on an active usage-based (PAYG) plan to top up without bouncing off the plan step.

  ### Behavioural changes
  - **`<PlanSelector.Grid>` keeps PAYG `currentPlanRef` cards selectable.** Previously every "Current" card was disabled (`disabled = isCurrent || isFree`), which on topup products — where `buildDefaultCheckoutPlanFilter` collapses the catalogue down to a single PAYG card — left the customer staring at an inert grid with no way forward. Recurring/one-time current cards stay disabled because re-selecting them would re-charge the customer; the PAYG branch is the topup conduit and re-entering it is the expected next action. The "Current" badge still renders so the customer sees their active plan.
  - **`<PlanSelector.Root>` auto-selects the customer's PAYG `currentPlanRef`** when it lands in the visible plan list. Topup checkout (`<CheckoutSteps.Root>` → `autoSelectFirstPaid: false`) now opens with `<CheckoutSteps.PlanContinueButton>` enabled instead of greyed-out. One-shot per `productRef` so a deliberate `clearSelection` doesn't immediately re-snap. Recurring/one-time current plans are not auto-selected — staying with `autoSelectFirstPaid: false`'s explicit-consent contract.
  - **`useCheckoutFlow.advance()` skips `transport.activatePlan` when the selected plan is already the customer's current plan.** PAYG re-activation is a no-op on the backend and the round-trip just adds latency plus a transient `status: 'activating'` flicker. The flow steps straight to the amount picker.

- cca77fb: Align `<CheckoutSteps>` PAYG topup flow with the hosted topup page and `<McpTopupView>` — drive amount + payment off the merchant's base currency, optimistically bump credits on success, and add the `topupCurrency` prop as a forward-compat hook for multi-currency topups.

  ### Currency invariant

  Credits are merchant-wide, not plan-specific. The PAYG topup branch (`<CheckoutSteps.AmountPicker>`, `<CheckoutSteps.AmountContinueButton>`, `<CheckoutSteps.Payment>` PAYG variant) now resolves currency strictly from:

  ```
  topupCurrency prop  →  merchant.defaultCurrency  →  null (UI gates)
  ```

  `plan.currency` is **never** consulted for the topup branch — using it would mismatch what the wallet actually settles in. Recurring/one-time plan purchases keep using `plan.currency` (correct for those, since they settle in the plan's denominated currency).

  ### Additions
  - **`topupCurrency?: string`** prop on `<CheckoutSteps.Root>` and `<PaywallNotice.EmbeddedCheckout>`. Defaults to `merchant.defaultCurrency`. Pass an explicit value when integrators surface a per-customer currency picker (multi-currency topup support, future).
  - **`flow.topupCurrency: string | null`** and **`flow.topupCurrencyReady: boolean`** on the `useCheckoutFlow` return value. Step components consume both via `useCheckoutContext`; while `!topupCurrencyReady`, the AmountPicker and Continue button render skeleton/disabled state instead of a misleading default.

  ### Behavioural changes
  - **Optimistic balance bump on PAYG success.** `useCheckoutFlow.recordPaygSuccess` now calls `balance.adjustBalance(creditsAdded)` so the header pill / `<BalanceBadge>` reflect the topup before the Stripe webhook lands. The `SolvaPayProvider`'s 8s grace window auto-reconciles via the deferred fetch — no race against the real webhook. Mirrors `<McpTopupView>`.
  - **`<RecurringPayment>` distinguishes recurring vs one-time** plans in submit-button + order-summary copy. Plans with `billingCycle` render `Subscribe — $X/cycle`; plans without (e.g. lifetime / one-time) render `Pay $X` with no `/cycle` suffix. Fixes a regression where lifetime plans rendered as `Subscribe — $X/mo`.
  - **`<CheckoutSteps.AmountPicker>` renders a skeleton row** while `useMerchant` is in flight and no explicit `topupCurrency` prop is passed. Ensures the picker never paints a misleading USD preset on a non-USD merchant during initial load. The merchant fetch is fast in practice (5-minute cache, often seeded), so this is rarely visible.

  ### Migration

  No breaking changes for existing single-currency integrators. Custom transports without a `getMerchant` adapter must pass `topupCurrency` explicitly (the only currency source available without merchant data) — same shape future multi-currency pickers will use.

- ae1f0aa: Add headless `useCheckoutFlow` hook + opt-in `<CheckoutSteps.*>` parts so MCP, paywall, and chatbot/web checkouts share one state engine while each owns its own layout. Also fix MCP-flavored copy bleed in `<PaywallNotice.Message>` for web integrators.

  ### Additions
  - **`useCheckoutFlow({ productRef, … })`** — headless state engine for the four-step activation flow (plan → amount [PAYG only] → payment → success). Owns step state, transitions, lifecycle callbacks (`onPlanSelect`, `onAmountSelect`, `onPurchaseSuccess`, `onError`), and the `transport.activatePlan` side-effect on the PAYG plan→amount edge. Must be called inside `<PlanSelector.Root>`. Exported from `@solvapay/react` and `@solvapay/react/primitives`.
  - **`<CheckoutSteps.*>`** — opt-in pre-styled parts (`Root`, `IfStep`, `PlanGrid`, `PlanContinueButton`, `AmountPicker`, `AmountContinueButton`, `Payment`, `BackLink`, `Success`) that compose on `useCheckoutFlow`. Class names follow the `solvapay-checkout-*` namespace. MCP and paywall surfaces add their own ancestor selectors (`.solvapay-mcp-shell .solvapay-checkout-card`) rather than remapping `classNames` per call site. Exported from `@solvapay/react` and `@solvapay/react/primitives`.
  - **i18n keys** — new `paywall.activationRequiredMessage`, `paywall.paymentRequiredMessageNoBalance`, `paywall.topupRequiredMessage` for web-friendly paywall copy that doesn't leak MCP tool names ("Call the `upgrade` tool…") into web UIs.

  ### Behavioural changes
  - **`<PaywallNotice.EmbeddedCheckout>` is now a stepped composition** of `<CheckoutSteps.*>` (plan → amount → payment → success with an explicit Continue between plan and the form). This is the SDK's recommended default for paywall surfaces. Apps wanting a different layout compose `<CheckoutSteps.*>` directly. Removes the previous one-shot composition where the PAYG amount picker and payment form coexisted on the same surface.
  - **`<PaywallNotice.Message>` resolves a kind-specific i18n string first**, falling back to `content.message` only when no kind-specific copy exists. Strict improvement: web UIs no longer surface MCP-flavored "Call the `upgrade` tool…" copy that was authored for CLI / MCP hosts. The MCP layer routes `content.message` through `content[0].text` (its actual consumer), so MCP behaviour is unchanged.
  - **`<PaywallNotice.EmbeddedCheckout>` and `<CheckoutSteps.Root>` ship a smart default plan filter.** Aligns the SDK with the hosted-checkout topup pattern (one usage-based plan + `<AmountPicker>` with currency presets — no separate "100 Credits" / "250 Credits" pack plans). The new `buildDefaultCheckoutPlanFilter(plans)` always hides Free plans, and hides PAYG when the product also exposes a non-PAYG paid plan so legacy / mixed configs render only the packs. PAYG-only products surface a single PAYG card on the plan step that the user clicks before continuing into the AmountPicker. Consumers passing an explicit `filter` prop keep their existing behaviour.

  ### MCP
  - `<McpCheckoutView>` and `mcp/views/checkout/EmbeddedCheckout` are now thin layout wrappers around `useCheckoutFlow`. The state machine moved to the hook; the MCP wrapper owns the bridge wiring (`notifyModelContext` on plan commit, `notifySuccess` on success, `sendMessage` on Stay-on-Free) and the MCP-specific chrome (banner, Stay-on-Free button). All existing `<McpCheckoutView>` tests pass unchanged.

- b53abcb: Add `useLimits` — a backend-authoritative hook for rendering "X left" pills against any (product, meter) pair.

  The runtime portion of the backend's `LimitResponse` (the same data `paywall.decide()` consults internally on every gated request) is now exposed read-only so consumers can render an honest counter without reinventing the math client-side. Replaces two common patterns:
  - `floor(useBalance().credits / plan.creditsPerUnit)` for prepaid usage-based products.
  - `messageLimit - userMessageCount` local refs for free-tier products.

  Both collapse onto one source of truth.

  ### `@solvapay/react`

  ```tsx
  import { useLimits } from '@solvapay/react'

  const { remaining, withinLimits, refetch, adjustRemaining } = useLimits({
    productRef: 'prd_api',
    meterName: 'requests', // optional; defaults to 'requests'
  })
  ```

  The minimal projection (`remaining`, `withinLimits`, `meterName`, `activationRequired`) is intentional — `plans` / `balance` / `productDetails` are already surfaced by `usePlans` / `useBalance` / paywall structured content.

  `activationRequired: true` distinguishes "free tier waiting to be claimed" from "exhausted" — both look like `remaining: 0` on the wire, but only the latter should drive an "Upgrade" CTA. Pair with `useActivation` to flip the customer onto the free tier when the backend's default plan needs explicit activation:

  ```tsx
  const { activationRequired } = useLimits({ productRef })
  const { activate } = useActivation()
  const freePlan = plans.find(p => !p.requiresPayment && (p.freeUnits ?? 0) > 0)

  useEffect(() => {
    if (activationRequired === true && freePlan?.reference) {
      activate({ productRef, planRef: freePlan.reference })
    }
  }, [activationRequired, freePlan?.reference, productRef, activate])
  ```

  `adjustRemaining(delta)` mirrors `useBalance().adjustBalance` — applies an 8 s optimistic grace window then auto-refetches. Use after a successful gated action so the pill snaps before the trailing refetch lands. Module-level cache keyed by `customerRef:productRef:meterName` with a 10 s TTL that mirrors the backend paywall's `limitsCacheTTL`. When the transport doesn't implement `getLimits` (e.g. an MCP adapter without the route), the hook returns `null` for `remaining` / `withinLimits` with `loading: false` — graceful fallback matching `useUsage`'s behaviour when `getUsage` is absent.

  ### `@solvapay/server`

  New `checkLimitsCore(request, options)` route helper mirrors `listPlansCore` — reads `productRef` (required) and `meterName` (optional) from query string, authenticates via `getAuthenticatedUserCore`, returns the full `LimitResponseWithPlan`. Reachable from both `@solvapay/server` and `@solvapay/server/edge`.

  ### Transport layer

  `SolvaPayTransport` gains an optional `getLimits({ productRef, meterName? })` method (parallel to `getBalance` / `getUsage`). The default HTTP transport routes to `GET /api/limits` (configurable via `SolvaPayConfig.api.getLimits`).

  ### `useAutoActivateFreePlan`

  New hook that encapsulates the "silently activate the free plan when the backend reports `activationRequired: true`" pattern from the demo. Pairs `useLimits`, `usePlans`, and `useActivation` behind a one-shot guard keyed by `${customerRef}:${productRef}` so failed activations don't retry on every render. Returns `{ pending, activated, error }` — use `pending` as a skeleton gate so the UI doesn't flash "0 left" between the limits fetch and the post-activation refetch.

  ```tsx
  import { useAutoActivateFreePlan } from '@solvapay/react'

  const { pending: autoActivating } = useAutoActivateFreePlan({ productRef })

  <UsagePill loading={autoActivating || limitsLoading} remaining={limitRemaining} />
  ```

  When the product has no free plan to activate (e.g. a PAYG-only product whose default plan needs activation but is paid), `pending` stays `false` so the consumer commits to the backend's actual `remaining` instead of stalling on a skeleton.

  ### `usePlans` in-flight cache fix

  Reordered the cache check so the in-flight branch wins over the fresh-cache branch. Previously two sibling `usePlans` calls against the same `productRef` could race: the second caller hit the fresh-cache branch (the in-flight slot carries `plans: []` + a fresh timestamp) and locked itself into "loading=false, plans=[]" until the TTL expired. The in-flight branch now coalesces correctly, and the fresh-cache branch only matches when `plans.length > 0`. Behaviour is unchanged for single-mount use; concurrent callers no longer need a workaround.

  ### Non-breaking

  All additions are additive: `useBalance` / `useUsage` are unchanged, `getLimits` is optional on the transport interface so existing custom transports keep working without modification, and the `usePlans` cache reorder is a strict bugfix (no API change).

### Patch Changes

- b53abcb: Soften amount-picker quick-pick chips from fully-rounded capsules (`border-radius: 999px`) to subtly rounded rectangles (`border-radius: 8px`) in both the SDK base stylesheet (`.solvapay-amount-picker-pill` / `[data-solvapay-amount-picker-option]`) and the MCP variant (`.solvapay-mcp-amount-option`). Keeps `<CheckoutSteps.AmountPicker>`, `<AmountPicker>`, the hosted topup page, and every `<Mcp*View>` topup/checkout surface visually consistent — the previous capsule shape read inconsistently between narrow MCP iframes (~520px) and wider web containers (~672px+).

  Consumers who prefer the previous capsule shape can restore it with a single override:

  ```css
  .solvapay-amount-picker-pill,
  [data-solvapay-amount-picker-option],
  .solvapay-mcp-amount-option {
    border-radius: 999px;
  }
  ```

  Quick-pick chips inside `.solvapay-amount-picker-pills` (the SDK's default amount-picker row used by `<AmountPicker>`, `<ActivationFlow.AmountPicker>`, and `<CheckoutSteps.AmountPicker>`) now stretch evenly across the row via `flex: 1; min-width: 0` instead of hugging their text content. Matches the dense, even-row look that hosted MCP surfaces already render via host CSS. The container's `flex-wrap: wrap` is preserved so chips wrap to a new line when the row is too narrow to fit them. Consumers who want the previous content-width behaviour can opt out with:

  ```css
  .solvapay-amount-picker-pills > [data-solvapay-amount-picker-option],
  .solvapay-amount-picker-pills > .solvapay-amount-picker-pill {
    flex: 0 0 auto;
  }
  ```

  The default amount-picker tree (`<AmountPicker>` shim and `<CheckoutSteps.AmountPicker>` `DefaultAmountTree`) now reserves vertical space for the credit-estimate line at all times instead of mounting it conditionally on first valid amount entry. Previously the form would jump downward by ~1 line the moment a user typed a custom amount or selected a quick-pick chip; the line is now always present, rendered with a non-breaking-space placeholder and `aria-hidden="true"` until an estimate is available. Behaviour is unchanged for hosts that pass `showCreditEstimate={false}` to the standalone `<AmountPicker>` shim — the line is omitted entirely there as before.

- 0240670: Fix `<McpApp>` shell content width on wide-iframe hosts. The previous CSS-only "fill iframe width" change removed the `max-width: 520px` cap from `.solvapay-mcp-main` so unbounded-iframe hosts (MCP Inspector, MCP Jam, full-browser previews) could use the column they hand us, but it overshot — at iframe widths beyond ~700px the AppHeader, body card, and LegalFooter all stretched to the iframe edges, splaying receipt rows with hundreds of pixels of dead air, blowing up the `width: 100%` button to ~800px, and producing >95-character body-copy line lengths.

  Re-introduce a single `max-inline-size: 520px` on `.solvapay-mcp-main` so the whole shell renders as one visually unified block centred in the iframe. The earlier `@media (min-width: 900px) { max-width: 960px }` sidebar-mode override is intentionally not carried forward — it was the cause of the felt-cramped problem on 1200px+ iframes.

  Also convert the wide-shell sidebar `@media (min-width: 900px)` query (`.solvapay-mcp-shell-sidebar` + `.solvapay-mcp-shell-layout` grid switch) to a `@container (min-width: 900px)` query, with `container-type: inline-size` on `.solvapay-mcp-main`. Without this, the sidebar grid would still fire on iframe viewport width — meaning at iframe widths ≥900px the `1fr + 320px` grid would activate inside the 520px capped shell, squeezing the body column to ~184px and breaking payment forms. Container queries fire on the shell's own width.

  When the shell renders the sidebar (authenticated customers — `isShellSidebarEligible` in `McpAppShell.tsx`), lift the cap to 900px via `.solvapay-mcp-main:has(.solvapay-mcp-shell-sidebar)`. Without this lift, `McpAppShell` would suppress the inline customer/seller detail cards in the body (assuming the sidebar takes them) while the sidebar would stay `display: none` (because the container threshold is never reached inside the 520 cap) — both copies hidden, customer details invisible for every authenticated user. With the lift, the 1fr + 320 sidebar grid has room and the container query fires correctly. Unauthenticated flows keep the tighter 520 cap.

  Below 520px (Claude Desktop ~400-500px, ChatGPT inline ~400px, Mobile Claude ~300-360px) the cap is a no-op and content fills the host's container, matching Anthropic's "apps fill the container width" guidance for the primary use cases. Above 520px the cap activates.

  Source-grounded basis for 520:
  - SEP-1865 §"Container Dimensions" — when the host omits `containerDimensions.width`/`maxWidth` (Unbounded mode) the spec delegates the size choice to the View.
  - OpenAI Apps SDK guidelines mandate "set a max width and design layouts that collapse gracefully on small screens".
  - OpenAI's `apps-sdk-ui` reservation card uses `max-w-sm` (384px); `openai-apps-sdk-examples` cluster sits at 220-360px.
  - Anthropic's PRIMARY use case is Desktop Claude at 400-500px. 520 is a small composite-flow buffer above that range — our `PlanStep → AmountStep → PaymentStep → SuccessStep` is slightly larger than a single-tool inline card.
  - At our 14px body, 520px ≈ 62ch — inside the 65-75ch optimal reading line length.

- b53abcb: `<MandateText>` now explicitly calls out that one-time charges are one-time. The `oneTime` mandate template (rendered by `<MandateText>`, `<PaywallNotice.EmbeddedCheckout>`, and `<CheckoutSteps.PaymentForm>` whenever the resolved plan is a one-time / lifetime plan) was previously indistinguishable from the recurring template at a glance: _"By confirming, you authorize Acme Inc to charge $99 for Widget API. Payments are processed by SolvaPay."_ — no signal that this is a single charge versus a subscription. Inserts "a one-time" before the amount so the sentence now reads _"...to charge a one-time $99 for Widget API..."_. Mirrors the disambiguation the `recurring` template gets via `every {period} until you cancel`.

  Integrators with snapshot tests pinned to the previous wording will need to update their fixtures. Integrators using a custom `copy.mandate.oneTime` override are unaffected.

- b53abcb: Fix `<PaywallNotice.EmbeddedCheckout>` so it dismisses synchronously on successful payment instead of waiting for `usePaywallResolver` to flip. Pre-fix, the checkout's `onPurchaseSuccess` only triggered a refetch and the parent's `onResolved` was fired by an effect that watched the resolver — backend / webhook lag (sandbox or local dev) could leave the success card stuck for 10s+ even after Stripe had confirmed the payment.

  `<PaywallNotice.Root>` now dedupes `onResolved` per-mount and exposes the deduped trigger via context, so `<EmbeddedCheckout>` can signal completion immediately on payment success while the resolver-driven path keeps working as a backstop. Inline `onResolved` arrows on the parent no longer re-trigger the effect either.

- cca77fb: `<PaywallNotice>` copy is now host-neutral and topup-aware.

  The default i18n strings used to leak MCP framing ("This tool needs an active plan…") into web surfaces. They've been rewritten in second person and split so the heading/message track whether the gate calls for a real plan or just more credits.

  ### Copy changes

  | Key                                  | Before                                                                      | After                                                              |
  | ------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
  | `paywall.activationRequiredHeading`  | `Add credits to continue`                                                   | `Activate a plan to continue`                                      |
  | `paywall.activationRequiredMessage`  | `This tool needs an active plan{forProduct}. Pick one below to keep going.` | `You need an active plan{forProduct} to continue. Pick one below.` |
  | `paywall.topupRequiredHeading` (new) | —                                                                           | `Add credits to continue`                                          |

  `paywall.topupRequiredMessage` (`You're out of credits{forProduct}. Add more below to keep going.`) is unchanged — it now actually gets used.

  ### Routing

  `<PaywallNotice.Heading>` and `<PaywallNotice.Message>` distinguish the topup variant of an `activation_required` gate from a subscription/lifetime activation. When every plan on `content.plans` has `type: 'usage-based' | 'hybrid'` (PAYG-only), they resolve to the topup heading + message; otherwise they resolve to the activation heading + message. `payment_required` is unchanged.

  ### Migration

  Integrators relying on the default `activationRequiredHeading` text get the corrected copy automatically. Integrators overriding `paywall.*` strings via the i18n bundle keep working — only one new optional key (`topupRequiredHeading`) was added; the runtime falls back to it for PAYG-only gates and `activationRequiredHeading` everywhere else.

- b53abcb: Topup-only paywalls now emit `kind: 'activation_required'` (with the PAYG plans attached) instead of `kind: 'payment_required'`. Fixes the React SDK rendering "Upgrade to continue" / "Pick a plan below to keep chatting" on a surface that only shows an amount picker — the existing `<PaywallNotice.Heading>` / `<PaywallNotice.Message>` resolvers now pick the topup-flavored copy automatically ("Add credits to continue" / "You're out of credits. Add more below to keep going.").

  The swap is conservative — `buildPaywallGate` only re-discriminates when:
  1. `activationRequired` is not set (the customer already has an active plan), AND
  2. `classifyPaywallState` returns `topup_required` (active usage-based plan, out of credits), AND
  3. `limits.plans` contains at least one paid plan AND every paid plan is PAYG (`type: 'usage-based' | 'hybrid'`). Free plans are filtered out before the check, so a typical Free + PAYG product still counts as topup-only.

  When any of those conditions doesn't hold (no plans on the response, mixed PAYG + recurring product, etc.) the gate stays on `payment_required` so the heading / message stay accurate. The internal `paywall-state` classifier and the MCP narration text generated by `buildGateMessage` were already producing topup copy for this case via the `topup_required` state — only the structured `kind` discriminant on the wire changes.

  ### Backward compat

  HTTP / Next adapter consumers branching on `gate.kind === 'payment_required'` for the topup case will now see `gate.kind === 'activation_required'`. The shape is otherwise identical (with `plans`, `balance`, `productDetails` all populated when available). MCP `<McpCheckoutView>` / `PlanStep` `paywallKind` branching is unaffected because the MCP topup flow routes through `<McpTopupView>` (a separate view discriminator) rather than the upgrade plan-step UI.

  Consumers who relied on `kind === 'payment_required'` to mean "this customer is over their free quota and needs to choose a plan" should switch to checking `kind === 'payment_required'` OR (`kind === 'activation_required'` AND not every paid plan is PAYG) for the same intent.

- cca77fb: Fix `usePaywallResolver` so `payment_required` gates carrying a `balance.creditsPerUnit` block resolve once the customer's wallet covers the next unit. This makes topup-shaped 402s (where the customer already has an active usage-based plan) dismiss automatically after a successful topup, instead of leaving consumers stuck on a static success surface.

  A topup creates a balance transaction, not a paid plan purchase, so `hasPaidPurchase` would never flip on subsequent topups. Treating the attached `balance` block the same way the `activation_required` branch does fixes the post-topup auto-dismiss for `<PaywallNotice.Root onResolved>` consumers.
  - @solvapay/mcp-core@0.2.4

## 1.1.4

### Patch Changes

- 8dd8638: Fix `McpAppFull.addEventListener`/`removeEventListener` types to accept the tighter `K extends keyof AppEventMap` shape introduced in `@modelcontextprotocol/ext-apps@^1.7`. Previously the loose `(evt: string, …)` signature on the interface didn't match what ext-apps exposes from 1.7+, so consumers seeing types from both `@solvapay/react` and `ext-apps@^1.7` would hit `TS2322: Type 'App' is not assignable to type 'McpAppFull'` at every `<McpApp app={...} />` mount site.

  The interface now declares `(evt: any, …)` for both event-listener fields, which is permissive enough to satisfy the new tightened generic without giving up the legacy `ontoolresult` setter fallback. Fixes [PR #169](https://github.com/solvapay/solvapay-sdk/pull/169).
  - @solvapay/mcp-core@0.2.4

## 1.1.3

### Patch Changes

- 9c66d68: Fix `usePlan` so it no longer fires a raw `fetch('/api/list-plans')` when an MCP transport is configured. The hook now routes through `defaultListPlans`, which is transport-aware and falls back to the seeded `plansCache` when the MCP adapter omits `listPlans` (the Phase 2c shape, where plans arrive in the bootstrap snapshot).

  This was the second symptom on Goldberg's ChatGPT App: the iframe sandbox returned 404 for `/api/list-plans` because the MCP origin doesn't serve that route. New regression test in `usePlan.test.tsx` covers the iframe-sandbox 404 pattern, and `ActivationFlow.test.tsx` was updated to seed `plansCache` directly to match the production MCP bootstrap pattern.

- Updated dependencies [36ac2ad]
- Updated dependencies [9c66d68]
  - @solvapay/mcp-core@0.2.4

## 1.1.2

### Patch Changes

- @solvapay/mcp-core@0.2.3

## 1.1.1

### Patch Changes

- Updated dependencies [4b3de6a]
  - @solvapay/mcp-core@0.2.2

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
