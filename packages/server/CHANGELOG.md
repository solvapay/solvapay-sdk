# @solvapay/server changelog

## 1.2.1

### Patch Changes

- 2de7fd8: Add Auth0 identity adapters across `@solvapay/auth`, `@solvapay/react`, and `@solvapay/next` (`createAuth0AuthMiddleware`), plus a `next-auth0` scaffolder template. The Next.js middleware now strips client-supplied identity headers (`x-user-id`, `authorization`) before forwarding a verified session identity downstream.
- c2a1169: Loosen internal `@solvapay/*` peerDependency ranges from `workspace:*` (exact) to `workspace:^` so a patch/minor bump of a peer no longer forces a major bump on its dependents. Affects `@solvapay/react` → `@solvapay/mcp-core`, `@solvapay/server` → `@solvapay/auth`, and `@solvapay/mcp` → `@solvapay/mcp-core`. This is a widening of the published peer range and is non-breaking for consumers.
- Updated dependencies [7a03c7f]
  - @solvapay/core@1.1.0

## 1.2.0

### Minor Changes

- 254498f: Expand `WebhookEventType` to the full live backend event catalog and derive the public union from the generated schema with a `WebhookPayloadObject` fallback for unlisted types.

## 1.1.1

### Patch Changes

- 26423fb: Await `trackUsage` on edge runtimes so paywall limits decrement correctly.

  Floating `trackUsage` promises were dropped when Cloudflare Workers returned
  the MCP response, so usage never reached the backend and free-quota gating
  never fired. All three paywall tracking paths now await tracking and swallow
  errors so tool calls stay reliable.

## 1.1.0

### Minor Changes

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

- b53abcb: Topup-only paywalls now emit `kind: 'activation_required'` (with the PAYG plans attached) instead of `kind: 'payment_required'`. Fixes the React SDK rendering "Upgrade to continue" / "Pick a plan below to keep chatting" on a surface that only shows an amount picker — the existing `<PaywallNotice.Heading>` / `<PaywallNotice.Message>` resolvers now pick the topup-flavored copy automatically ("Add credits to continue" / "You're out of credits. Add more below to keep going.").

  The swap is conservative — `buildPaywallGate` only re-discriminates when:
  1. `activationRequired` is not set (the customer already has an active plan), AND
  2. `classifyPaywallState` returns `topup_required` (active usage-based plan, out of credits), AND
  3. `limits.plans` contains at least one paid plan AND every paid plan is PAYG (`type: 'usage-based' | 'hybrid'`). Free plans are filtered out before the check, so a typical Free + PAYG product still counts as topup-only.

  When any of those conditions doesn't hold (no plans on the response, mixed PAYG + recurring product, etc.) the gate stays on `payment_required` so the heading / message stay accurate. The internal `paywall-state` classifier and the MCP narration text generated by `buildGateMessage` were already producing topup copy for this case via the `topup_required` state — only the structured `kind` discriminant on the wire changes.

  ### Backward compat

  HTTP / Next adapter consumers branching on `gate.kind === 'payment_required'` for the topup case will now see `gate.kind === 'activation_required'`. The shape is otherwise identical (with `plans`, `balance`, `productDetails` all populated when available). MCP `<McpCheckoutView>` / `PlanStep` `paywallKind` branching is unaffected because the MCP topup flow routes through `<McpTopupView>` (a separate view discriminator) rather than the upgrade plan-step UI.

  Consumers who relied on `kind === 'payment_required'` to mean "this customer is over their free quota and needs to choose a plan" should switch to checking `kind === 'payment_required'` OR (`kind === 'activation_required'` AND not every paid plan is PAYG) for the same intent.

## 1.0.12

### Patch Changes

- 8dd8638: Bump runtime `dotenv` dependency from `^17.4.1` to `^17.4.2` (patch). No behaviour change — picks up upstream bug fixes.

## 1.0.11

### Patch Changes

- Updated dependencies [40db2c4]
  - @solvapay/core@1.0.9

## 1.0.10

### Patch Changes

- 4b3de6a: Resync stable manifests so dependents pin to stable `@solvapay/core` and `@solvapay/auth` instead of the leftover `1.0.8-preview.10` references that the previous release accidentally baked into `@solvapay/server@1.0.9`, `@solvapay/next@1.0.8`, `@solvapay/mcp-core@0.2.1`, and `@solvapay/mcp@0.2.1`.

  The root cause was that `core`, `auth`, `solvapay` (CLI), and `react-supabase` had pre-release `1.0.8-preview.X` strings sitting in their `package.json` `version` fields on `main` (leftovers from the pre-changesets preview workflow that the migration commit never reset). Because no changeset had touched those four since the migration, changesets-action never bumped them, and `pnpm publish` substituted every `workspace:*` reference in the recently-released siblings with that literal preview string.

  This changeset:
  - Resets `core`, `auth`, `solvapay`, and `react-supabase` to the last actually-published stable (`1.0.7`) so the patch bumps below land on `1.0.8`.
  - Forces a patch bump on `server`, `next`, `mcp-core`, and `mcp` so they re-publish with their workspace dep references substituted from the now-stable `1.0.8` siblings.

  The publish workflow has also been hardened to reject any workspace package that carries a pre-release version identifier on `main` before invoking `changesets/action`, and `scripts/verify-npm-publishes.mjs` now checks each freshly-published manifest for `dependencies` / `peerDependencies` values that resolve to pre-release identifiers — both of which would have caught this regression.

- Updated dependencies [4b3de6a]
  - @solvapay/core@1.0.8
  - @solvapay/auth@1.0.8

## 1.0.9

### Patch Changes

- 0938625: `createRequestDeduplicator` now starts its background cleanup interval
  on first `deduplicate()` call instead of at construction time. Fixes a
  hard-boot failure on Cloudflare Workers (and any other runtime that
  forbids timers / async I/O in the global scope — see the Workers
  "Disallowed operation called within global scope" error) when the
  paywall's module-scope `sharedCustomerLookupDeduplicator` is
  instantiated during Worker module load.

  No observable behaviour change for existing Node / Deno / Supabase Edge
  consumers: the cleanup interval was always driven by cache turnover,
  and nothing is actually in the cache until the first `deduplicate()`
  call anyway.

From `1.0.8` onwards this changelog is generated by
[changesets](https://github.com/changesets/changesets) — entries
below are the hand-set rescue release that bypassed the Changesets
peer-dep cascade.

## 1.0.8

Two edge-entrypoint fixes, a gate-message narration refresh, and the
`@solvapay/fetch` → `@solvapay/server/fetch` consolidation. Hand-set
version (the Changesets peer-dep cascade would otherwise have forced
this to `1.1.0` because of the `text-only-paywall` minor; we're
keeping it on `1.0.x` because the public API surface is additive —
the new `./fetch` subpath and the restored edge re-exports are pure
additions, and the only semantic change is the gate `message` copy,
which is narration for LLMs, not a typed contract). See
`.changeset/hand-set-versions-consolidation.md` for the full
rationale.

### Fixed: edge entrypoint — restore missing paywall-state re-exports

`packages/server/src/edge.ts` now re-exports the pure paywall-state
engine (`buildGateMessage`, `buildNudgeMessage`, `classifyPaywallState`

- the `PaywallState` discriminant), the runtime type guard
  `isPaywallStructuredContent`, and the shared payment / MCP-bootstrap
  types (`PaymentMethodInfo`, `SdkMerchantResponse`, `SdkProductResponse`,
  `components`, `LimitResponseWithPlan`, `PaywallDecision`, etc.) that
  `@solvapay/mcp-core` already imports from its top-level
  `@solvapay/server` import.

Why: Deno (and every other `edge-light` / `worker` / `deno`
runtime) resolves `@solvapay/server` via the `deno` export condition
to `./dist/edge.js`. Before this fix the Node entrypoint
(`./dist/index.js`) carried the paywall-state helpers but the edge
entrypoint did not, so `@solvapay/mcp-core@0.2+` booted on Deno with
`SyntaxError: The requested module '@solvapay/server' does not
provide an export named 'buildNudgeMessage'` — the BOOT_ERROR the
Goldberg Supabase edge MCP deploy was hitting.

No semver-affecting surface change vs. the Node entrypoint — these
symbols were already stable on `./dist/index.js`.

### Added: edge-entrypoint regression smoke test

`packages/server/src/__tests__/edge-exports.test.ts` — a smoke test
that imports every symbol `@solvapay/mcp-core` / `@solvapay/mcp/fetch`
pull through their top-level `@solvapay/server` import and asserts
each one resolves on `./edge`. Complements the existing
`__tests__/edge-exports.unit.test.ts` (scoped to `*Core` route
helpers consumed by `@solvapay/fetch`).

Prevents a recurrence of the Goldberg boot crash where
`@solvapay/mcp-core@0.2` started importing `buildNudgeMessage` +
`isPaywallStructuredContent` from `@solvapay/server`; those lived
only in `src/index.ts`, so Deno's `deno` export condition resolved
to `dist/edge.js` and crashed at module-load time with `does not
provide an export named 'buildNudgeMessage'`.

### Changed: gate-message narration (SEP-1865 text-only paywall)

`classifyPaywallState` + a newly exported `buildGateMessage` produce
the narration that rides on `content[0].text` when a merchant
payable tool exhausts its paywall. The previous "Pick a plan below
to keep going" text is gone; the new narration names the recovery
intent tool (`upgrade` / `topup` / `activate_plan`) and inlines
`gate.checkoutUrl` for terminal-first hosts. Client code that
asserted substrings on `gate.message` needs to update.

The structured gate shape (`kind`, `checkoutUrl`, `plans`,
`balance`, `productDetails`) is unchanged — this is a narration
refresh, not a typed contract change. Released as patch despite the
copy shift because `gate.message` has always been documented as
narration, not a stable identifier.

### Added: `./fetch` subpath export (Web-standards Request → Response handlers)

Folds the standalone `@solvapay/fetch@1.0.0` package into
`@solvapay/server` as a new subpath export:

```diff
- import { checkPurchase } from '@solvapay/fetch'
+ import { checkPurchase } from '@solvapay/server/fetch'
```

Every export from the old package carries over unchanged:
`checkPurchase`, `trackUsage`, `createPaymentIntent`, `processPayment`,
`createTopupPaymentIntent`, `customerBalance`, `cancelRenewal`,
`reactivateRenewal`, `activatePlan`, `getPaymentMethod`, `listPlans`,
`syncCustomer`, `createCheckoutSession`, `createCustomerSession`,
`getMerchant`, `getProduct`, `solvapayWebhook`, `configureCors`. Same
signatures, same CORS-by-default behaviour, same `Deno.serve(handler)`
one-liner deploy pattern.

Why fold it in: the fetch handlers are ~290 LOC of thin
`Request → Response` wrappers around `*Core` helpers that already
live in `@solvapay/server`. Splitting them into their own package
was pulling its own peer-dep matrix + changeset file + install
instructions for zero runtime benefit — `@solvapay/fetch` had
`@solvapay/server` as a `dependencies:` anyway, so every install
already carried the server payload. Subpath export gives the same
ergonomics with one less install line.

Fixes a latent async-webhook bug while folding in:
`solvapayWebhook()` used to call `verifyWebhook({...})` WITHOUT
`await` and without explicitly importing from `'../edge'`. Deno
happened to resolve `@solvapay/server` to `./dist/edge.js` (async
Web Crypto variant), so the un-awaited Promise got coerced through
`options.onEvent(event)` as a Promise cast to `WebhookEvent` —
strict TypeScript handlers that destructured `event.type`
synchronously saw `undefined`. The new `./fetch` subpath imports
`verifyWebhook` from `'../edge'` explicitly and adds the missing
`await`, so the handler deterministically returns the parsed
`WebhookEvent` regardless of which export condition a consumer's
bundler picks.

Peer-dependencies: `@solvapay/auth` was already a peer of
`@solvapay/server` (required for the `*Core` route helpers'
authentication path), so fetch consumers don't need to install
anything new.

## Historical appendix — `@solvapay/fetch` (unpublished)

The standalone `@solvapay/fetch` package shipped `1.0.0` on
2026-04-25 as a rename of `@solvapay/supabase@1.0.1`. It had 0
external dependents and was inside the 72-hour unpublish window at
the time of consolidation. The `@solvapay/fetch` name is being
unpublished from npm alongside this `@solvapay/server@1.0.8`
release (see Step 8 of
[.cursor/plans/mcp_packages_consolidation_c16e83c1.plan.md](../../.cursor/plans/mcp_packages_consolidation_c16e83c1.plan.md)).
Consumers who installed the brief-lived `@solvapay/fetch@1.0.0`
upgrade by swapping the package name for the new subpath:

```diff
- "@solvapay/fetch": "^1.0.0"
+ "@solvapay/server": "^1.0.8"
```

```diff
- import { checkPurchase } from '@solvapay/fetch'
+ import { checkPurchase } from '@solvapay/server/fetch'
```

The source lineage `@solvapay/supabase` → `@solvapay/fetch` →
`@solvapay/server/fetch` is preserved in git history via `git mv`
on every file in the move.
