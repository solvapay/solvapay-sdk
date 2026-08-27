# @solvapay/core

## 1.5.0

### Minor Changes

- a47adff: Free plans with an included allowance now count usage and label the meter correctly.

  `@solvapay/core` adds `countsUsage` (per-unit charge, tier, or limit) and `meterName`
  (per-unit charge's meter, else the first limit's meter). A free tier with a bare
  limit is not priced per unit, but it still needs a usage counter and a meter noun —
  `isMetered` on the wire was the wrong question for both.

  `planMeterName` uses the new reader, so a recurring allowance no longer renders the
  literal "units". `useAutoActivateFreePlan` no longer requires deprecated `freeUnits`
  on the plan row. Usage surfaces (`useUsage`, `getUsageCore`, plan cards) derive
  from `options[]` instead of trusting `planSnapshot.isMetered` alone.

## 1.4.0

### Minor Changes

- e936ac0: Plan pricing is read from the wire's `options[]` instead of scalar fields the backend stopped sending.

  `GET /v1/sdk/products/:ref/plans` returns pricing as a composable `options[]` array
  (`charge`, `billingCycle`, `limit`, `trial`) with a derived headline `price`. The SDK
  was still reading `planType`, `creditsPerUnit`, `billingCycle`, `meterRef`, `limit`, and
  `pricingOptions` off the plan — none of which appear in the schema. Because every test
  fixture hand-wrote those fields, the suites passed while real payloads silently took the
  wrong branch.

  **New — `@solvapay/core` pricing-option readers.** `charges`, `headlineCharges`,
  `perUnitCharge`, `billingCycle`, `trialDays`, `includedUnits`, `peggedCreditsPerUnit`,
  and `creditsPerUnitFromBalance` read a plan or a frozen plan snapshot. One reader for
  both the MCP text narration and the MCP UI panel, so the two agree.

  **Fixed — every paid plan rendered as a one-time payment.** The billing cycle now comes
  from the `billingCycle` option, so subscriptions show the `/month` suffix and the
  "start your _plan_ plan" payment copy again instead of "complete the purchase".

  **Fixed — plan labels.** `narrate` derives the label from `type` plus `requiresPayment`,
  so one-time, hybrid ("subscription + usage"), pay-as-you-go, and free plans are no longer
  all labelled "recurring". `'free'` and `'trial'` were never backend plan types: a free
  plan is `requiresPayment: false` and a trial is a `trial` option. The upgrade surface
  filters on `requiresPayment`, which stops it offering a $0 plan.

  **Fixed — "Cost per call" was absent, and the credit figure was wrong.** The rate is a
  per-unit charge in **minor units**, not credits, so converting needs the wallet's peg
  (`creditsPerMinorUnit` and `displayExchangeRate`). The row is emitted only when the
  charge currency matches `balance.displayCurrency` — the peg carries no cross-currency
  rate, so anything else would be wrong by the FX ratio. With no balance to peg against,
  PAYG surfaces show the charge itself (`$0.02 / call`) rather than inventing a credit
  count.

  **Fixed — included allowance counted the wrong thing.** It is the `limit` option's `cap`,
  counted in metered items, and it is labelled with the plan's meter. `0` is the backend's
  unlimited sentinel and is no longer shown as an allowance of zero.

  **Fixed — pay-as-you-go resolved as a free plan.** `resolvePlanShape` keyed off
  `planType`, `meterRef`, `meterId`, and `limit`, so every plan fell through to its unknown
  branch. A PAYG plan has no headline `price` and so came back `'free'`: no Top up action,
  a Cancel action for a plan with no renewal to cancel, and the free-usage activity strip
  instead of the balance. Metered subscriptions were also indistinguishable from unlimited
  ones. The shape now derives from `options[]` — a billing cycle separates a subscription
  from a one-off, a per-unit charge or included allowance marks it metered — and works for
  both a plan and the frozen snapshot on a purchase, which carry different fields.

  **Breaking — `SuccessMeta`.** `creditsIncluded` is replaced by `includedUnits` plus
  `meterName`. The old field claimed credits while carrying a per-cycle item allowance.

  **Breaking — `PlanLike`** (`@solvapay/react/mcp`) drops `planType`, `meterRef`,
  `meterId`, and `limit` for `options`, `requiresPayment`, and `isMetered`, matching what
  the backend sends.

  **Deprecated on `Plan`.** `pricingOptions`, `creditsPerUnit`, `billingCycle`, `freeUnits`,
  `setupFee`, `trialDays`, `limit`, and `rolloverUnusedUnits` are kept for consumers who
  build plans through a custom fetcher, but the backend does not send them — read `options[]`
  instead. `Plan.type` adds `'hybrid'`.

## 1.3.0

### Minor Changes

- 800f081: Business-details and seller-identity validation now share a single Stripe Tax buyer jurisdiction list (`tax-jurisdictions`), so tax-ID formats, labels, and supported countries match what the platform accepts at checkout. Country-aware tax-ID validation covers every jurisdiction Stripe Tax registers in rather than the previous hand-maintained subset.
- 3a310eb: Add tiered product config validation: sync `productRef` shape checks + one-line MCP config logging, enriched OAuth DCR failure diagnostics, opt-in `verifyProductConfiguration()` on `@solvapay/server`, and `solvapay doctor` for explicit network checks (secret key, product existence, readiness).

## 1.2.0

### Minor Changes

- ede9365: Add business purchase support for credit top-ups: shared BusinessDetails validation in core, TopupForm.BusinessDetails/Summary primitives, attachTopupBusinessDetails server SDK method, and checkout-demo example wiring.
- 985acd1: Add `resolveSellerIdentityDisplay` to `@solvapay/core` for country-aware seller tax and company-number rows. `McpSellerDetailsCard` now uses the core resolver with unified display labels (`VAT number`, `EIN`, `Company number`).

## 1.1.1

### Patch Changes

- 349777e: Financial boundary hardening: backend `display.*` blocks are the source of truth for credit and currency rendering.
  - **`@solvapay/core`**: conversion-contract e2e extended to pin backend display formulas against the core reference.
  - **`@solvapay/react`**: `TransportBalanceResult` and `BalanceStatus` accept optional `display` from the balance API; negative `adjustBalance` schedules a grace refetch; usage demo refetches after debit.
  - **`@solvapay/server`**: `AutoRechargeConfig`, balance, and credit-debit types document backend-computed `display` blocks and `autoRecharge.triggered` as charge-initiated (not credits booked inline).

## 1.1.0

### Minor Changes

- 7a03c7f: Credit → fiat display helpers (`creditsToDisplayMinorUnits`, `minorUnitsPerMajor`, `isZeroDecimalCurrency`) now live in `@solvapay/core` so Next.js client components can import them without pulling the Node-only `@solvapay/mcp-core` server bundle. `@solvapay/mcp-core` re-exports the same symbols for backward compatibility.

## 1.0.9

### Patch Changes

- 40db2c4: Release-bot validation bump. The publish workflow ([`.github/workflows/publish.yml`](.github/workflows/publish.yml)) now mints a 60-minute installation token from the `solvapay-release-bot` GitHub App via `actions/create-github-app-token@v2` so `changesets/action` can open the "Version Packages" PR without tripping the org's `can_approve_pull_request_reviews: false` policy on the default `GITHUB_TOKEN`. This patch exists to drive a real end-to-end run through the new credential path; no code changes ship with it.

## 1.0.8

### Patch Changes

- 4b3de6a: Resync stable manifests so dependents pin to stable `@solvapay/core` and `@solvapay/auth` instead of the leftover `1.0.8-preview.10` references that the previous release accidentally baked into `@solvapay/server@1.0.9`, `@solvapay/next@1.0.8`, `@solvapay/mcp-core@0.2.1`, and `@solvapay/mcp@0.2.1`.

  The root cause was that `core`, `auth`, `solvapay` (CLI), and `react-supabase` had pre-release `1.0.8-preview.X` strings sitting in their `package.json` `version` fields on `main` (leftovers from the pre-changesets preview workflow that the migration commit never reset). Because no changeset had touched those four since the migration, changesets-action never bumped them, and `pnpm publish` substituted every `workspace:*` reference in the recently-released siblings with that literal preview string.

  This changeset:
  - Resets `core`, `auth`, `solvapay`, and `react-supabase` to the last actually-published stable (`1.0.7`) so the patch bumps below land on `1.0.8`.
  - Forces a patch bump on `server`, `next`, `mcp-core`, and `mcp` so they re-publish with their workspace dep references substituted from the now-stable `1.0.8` siblings.

  The publish workflow has also been hardened to reject any workspace package that carries a pre-release version identifier on `main` before invoking `changesets/action`, and `scripts/verify-npm-publishes.mjs` now checks each freshly-published manifest for `dependencies` / `peerDependencies` values that resolve to pre-release identifiers — both of which would have caught this regression.
