# SDK Product Model Redesign Questionnaire

Questionnaire to inform the redesign of the SolvaPay SDK for the Product-centric backend model. See also the backend [Schema Design](../../../solvapay-backend/docs/DATA_SCHEMA_DESIGN.md) and [Schema Questionnaire](../../../solvapay-backend/docs/data-model-redesign/DATA_SCHEMA_QUESTIONNAIRE.md).

## Context

The SDK is a monorepo with 6 published packages (`@solvapay/core`, `@solvapay/server`, `@solvapay/auth`, `@solvapay/react`, `@solvapay/next`, `@solvapay/react-supabase`) and 5 example apps. Current version: `1.0.0-preview.18`. No external users.

The backend is replacing the Agent/MCP Server dual-entity model with a unified Product entity (backend decisions D1-D18). The SDK currently references `agent`/`agentRef` in ~40 touchpoints across all packages and uses `PaymentIntent` as a concept that the backend is replacing with `Payment`.

**Pre-launch status:** No backward compatibility required. No deprecated aliases. Clean cut on all code. This is the opportunity to eliminate all technical debt.

### Current agent/agentRef Touchpoints

**`@solvapay/server` (packages/server/):**
- `PayableOptions.agent`, `PayableOptions.agentRef` — payable config
- `PaywallMetadata.agent` — internal paywall metadata
- `PaywallStructuredContent.agent` — error response field
- `SolvaPayPaywall.resolveAgent()` — internal method
- `SolvaPayPaywall.trackUsage(agentRef)` — internal method
- `SolvaPayPaywall.protect()` passes `agentRef: agent` to `checkLimits()`
- `SolvaPayClient.listAgents()`, `.createAgent()`, `.deleteAgent(agentRef)`
- `SolvaPayClient.listPlans(agentRef)`, `.createPlan({ agentRef })`
- `SolvaPayClient.createPaymentIntent({ agentRef })`, `.processPayment({ agentRef })`
- `SolvaPay.createPaymentIntent({ agentRef })`, `.processPayment({ agentRef })`, `.checkLimits({ agentRef })`, `.trackUsage({ agentRef })`, `.createCheckoutSession({ agentRef })`
- `createPaymentIntentCore(request, { agentRef })`, `processPaymentCore(request, { agentRef })`, `createCheckoutSessionCore(request, { agentRef })`
- `listPlansCore()` reads `agentRef` from query params, returns `{ plans, agentRef }`
- Factory `payable()` resolves agent from `options.agentRef || options.agent || env || package.json`
- HTTP/Next.js error responses include `agent` field

**`@solvapay/react` (packages/react/):**
- `PurchaseInfo.agentName`
- `useCheckout(planRef, agentRef?)`
- `PaymentFormProps.agentRef`
- `PlanSelectorProps.agentRef`
- `UsePlansOptions.agentRef`
- `SolvaPayContextValue.createPayment({ agentRef })`, `.processPayment({ agentRef })`
- `SolvaPayProviderProps.processPayment({ agentRef })`

**`@solvapay/next` (packages/next/):**
- `createPaymentIntent(request, { agentRef })`, `processPayment(request, { agentRef })`, `createCheckoutSession(request, { agentRef })`
- `listPlans` return includes `agentRef`
- `PurchaseCheckResult.purchases[].agentName`

**Generated types (packages/server/src/types/generated.ts):**
- `CheckLimitRequest.agentRef` OR `CheckLimitRequest.mcpServerRef` branching
- `/v1/sdk/agents` paths, `AgentSdkController_*` operation names
- `CreateAgentRequest`, `UpdateAgentRequest` schemas
- `PurchaseResponse.agentRef`, `.agentName`
- `UsageEvent.agentRef`

---

## Decisions Made

### D1. Replace all `agent`/`agentRef` with `product`/`productRef`

Clean rename across all packages. No deprecated aliases. `product` is the short form for config, `productRef` is the explicit reference identifier.

**What changes:**
- `PayableOptions.agent` -> `PayableOptions.product`
- `PayableOptions.agentRef` -> `PayableOptions.productRef`
- `SolvaPay.payable({ agent: 'agt_xxx' })` -> `SolvaPay.payable({ product: 'prod_xxx' })`
- All `SolvaPayClient` methods: `agentRef` param -> `productRef`
- All `SolvaPay` interface methods: `agentRef` param -> `productRef`
- All Core helpers: `agentRef` param -> `productRef`
- All React hooks/components: `agentRef` prop -> `productRef`
- All Next.js helpers: `body.agentRef` -> `body.productRef`
- Environment variable: `SOLVAPAY_AGENT` -> `SOLVAPAY_PRODUCT`

> *Rationale: Product is the backend's commercial entity (D1). The SDK should use the same term. No users to migrate. Clean cut eliminates confusion between agent (future operational concept) and product (what you sell).*

### D2. Reference prefix is `prod_`

Products use `prod_` prefix (e.g. `prod_8XK2M4`), matching the backend schema design. Purchases use `pur_`, Payments use `pay_`.

> *Rationale: Consistent with backend. No reason to diverge.*

### D3. Eliminate `agentRef`/`mcpServerRef` branching in CheckLimitRequest

The current generated `CheckLimitRequest` has `agentRef?: string` OR `mcpServerRef?: string`. The new version will have a single `productRef: string` (required).

**What changes:**
- `checkLimits({ customerRef, agentRef })` -> `checkLimits({ customerRef, productRef })`
- No more optional fields or branching logic

> *Rationale: Backend unifies behind productId (backend D1). The SDK's limit check becomes simpler — one required field instead of two optional mutually exclusive fields.*

### D4. No backward compatibility. No deprecated aliases. Clean cut.

Pre-launch. No external users. No `agent` compatibility layer. No shimming. Remove all Agent CRUD from the SDK.

> *Rationale: Confirmed pre-launch status. Backend D7 applies to SDK as well. Technical debt elimination.*

### D5. `createPaymentIntent` and `processPayment` keep their method names

These method names describe the Stripe client-side flow (creating and confirming a Stripe PaymentIntent), which hasn't changed. The backend now creates a Payment entity internally, but from the SDK integrator's perspective, they're still working with Stripe PaymentIntents for client-side confirmation.

**What changes:**
- Method names stay: `createPaymentIntent`, `processPayment`
- Params change: `agentRef` -> `productRef`
- Return type of `processPayment` references Purchase (not PaymentIntent entity)

**What stays the same:**
- Return shape from `createPaymentIntent`: `{ id, clientSecret, publishableKey, accountId }`
- The payment flow: create intent -> confirm on client -> process on server -> purchase created

> *Rationale: "Payment intent" is a Stripe concept the integrator is familiar with. Renaming to `createPayment` would be confusing since the SDK method creates a Stripe PaymentIntent, not a SolvaPay Payment. The internal entity mapping is the backend's concern.*

### D6. Stay in `1.0.0-preview.X` range. No major version bump needed.

Bump to `1.0.0-preview.19` (or next available). Pre-1.0-stable means breaking changes are expected. No semver major needed.

> *Rationale: Preview range signals instability. Breaking changes are normal. No users to communicate migration to.*

### D7. Expose Payment as read-only in the SDK

Add `listPayments` to `SolvaPayClient` for billing history. Do not expose Payment CRUD — payments are created by the backend (via billing flow, webhooks), not by SDK integrators.

**What changes:**
- Add `SolvaPayClient.listPayments({ purchaseRef?, productRef?, customerRef? })` — read-only
- Add `SolvaPay.listPayments(params)` convenience method
- React: add `usePayments()` hook (phase 2, not blocking)

> *Rationale: Integrators need billing history for customer-facing UI (invoices, receipts, retry status). Payment creation is a backend concern (Stripe webhooks, renewal cron). SDK is read-only for payments.*

### D8. SDK has zero awareness of MCP Pay

The SDK is for providers who integrate code. MCP Pay is a no-code product where SolvaPay hosts everything. The SDK should not reference `isMcpPay`, MCP Pay product types, or any MCP Pay-specific config.

The `payable.mcp()` adapter stays — it's for providers running their own MCP servers with SDK integration. The adapter name describes the framework (MCP protocol), not the product type.

> *Rationale: MCP Pay users never touch the SDK. Mixing the concepts would confuse both audiences. The backend uses `isMcpPay` as an internal flag (backend D4) — it should not leak into the SDK.*

### D9. `PaywallMetadata` and `PaywallStructuredContent` use `product`

Internal paywall types rename `agent` to `product`:
- `PaywallMetadata.agent` -> `PaywallMetadata.product`
- `PaywallStructuredContent.agent` -> `PaywallStructuredContent.product`
- `PaywallError` structured content exposes `product` not `agent`
- HTTP/Next.js error responses return `product` field instead of `agent`

> *Rationale: The paywall protects access to a product. The term should match. Error responses seen by integrators should use consistent terminology.*

### D10. `PurchaseInfo` updated for long-lived purchase model

The React `PurchaseInfo` type and Next.js `PurchaseCheckResult` update to reflect the new model:

**Fields renamed:**
- `agentName` -> `productName`

**Fields added:**
- `productReference: string`
- `planType: string` — `'recurring' | 'usage-based' | 'one-time' | 'hybrid'`
- `isRecurring: boolean`
- `nextBillingDate?: string`
- `billingCycle?: string`

**Fields added (usage-based plans):**
- `usage?: { used: number, quota: number | null, unit: string, remaining: number | null }`

**Fields kept:**
- `reference`, `planName`, `status`, `startDate`, `endDate`, `cancelledAt`, `cancellationReason`, `amount`

> *Rationale: Long-lived purchases carry more state (billing, usage). Integrators need this for UI (show remaining usage, next billing date, plan type badges). Matches backend Purchase schema (backend D9, D17, D18).*

### D11. Purchase statuses are a union type

SDK exposes all 8 statuses from backend D11 as a TypeScript union, not a free-form string:

```typescript
type PurchaseStatus = 'pending' | 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired' | 'suspended' | 'refunded'
```

> *Rationale: Type safety for integrators. Matches backend D11 exactly. No additional statuses needed in the SDK.*

### D12. Rename `SolvaPayClient` agent methods to product methods

| Current method | New method |
|---|---|
| `listAgents()` | `listProducts()` |
| `createAgent(params)` | `createProduct(params)` |
| `deleteAgent(agentRef)` | `deleteProduct(productRef)` |
| `listPlans(agentRef)` | `listPlans(productRef)` |
| `createPlan({ agentRef, ... })` | `createPlan({ productRef, ... })` |
| `deletePlan(agentRef, planRef)` | `deletePlan(productRef, planRef)` |
| `createPaymentIntent({ agentRef, ... })` | `createPaymentIntent({ productRef, ... })` |
| `processPayment({ agentRef, ... })` | `processPayment({ productRef, ... })` |
| `checkLimits({ agentRef \| mcpServerRef })` | `checkLimits({ productRef })` |
| `trackUsage({ agentRef, ... })` | `trackUsage({ productRef, ... })` |

**New methods added:**
- `listPayments({ purchaseRef?, productRef?, customerRef? })` — read-only

**Methods removed:**
- None removed (agent methods are renamed, not dropped)

> *Rationale: 1:1 rename. Agent -> Product. No methods lost. One method gained (listPayments). checkLimits simplified from two optional fields to one required field.*

### D13. `SolvaPay` factory interface method updates

All convenience methods on the `SolvaPay` interface update `agentRef` -> `productRef`:

```typescript
interface SolvaPay {
  payable(options?: PayableOptions): PayableFunction
  ensureCustomer(customerRef, externalRef?, options?): Promise<string>
  createPaymentIntent(params: { productRef: string, planRef: string, customerRef: string, idempotencyKey?: string }): Promise<...>
  processPayment(params: { paymentIntentId: string, productRef: string, customerRef: string, planRef?: string }): Promise<...>
  checkLimits(params: { customerRef: string, productRef: string }): Promise<...>
  trackUsage(params: { customerRef: string, productRef: string, planRef: string, ... }): Promise<void>
  createCustomer(params): Promise<...>
  getCustomer(params): Promise<...>
  createCheckoutSession(params: { productRef: string, customerRef: string, planRef?: string, returnUrl?: string }): Promise<...>
  createCustomerSession(params): Promise<...>
  listPayments(params: { purchaseRef?: string, productRef?: string, customerRef?: string }): Promise<...>  // NEW
  apiClient: SolvaPayClient
}
```

> *Rationale: Mirrors SolvaPayClient renames. listPayments added as convenience method.*

### D14. Factory `payable()` auto-resolution changes

Current: `options.agentRef || options.agent || process.env.SOLVAPAY_AGENT || packageJsonName || 'default-agent'`

New: `options.productRef || options.product || process.env.SOLVAPAY_PRODUCT || 'default-product'`

**Drop package.json name auto-detection.** This was a convenience that assumed one product per app. With Product as the explicit entity, require explicit configuration or env var.

> *Rationale: Auto-detecting product from package.json name is confusing ("why is my product called my-express-app?"). Products have explicit references like `prod_8XK2M4`. Require explicit configuration.*

### D15. Core route helpers rename `agentRef` -> `productRef`

| Current function | Param change |
|---|---|
| `createPaymentIntentCore(req, { planRef, agentRef })` | `{ planRef, productRef }` |
| `processPaymentCore(req, { paymentIntentId, agentRef })` | `{ paymentIntentId, productRef }` |
| `createCheckoutSessionCore(req, { agentRef, planRef? })` | `{ productRef, planRef? }` |
| `listPlansCore(req)` — reads `agentRef` from query | reads `productRef` from query, returns `{ plans, productRef }` |

Validation messages update: `"agentRef is required"` -> `"productRef is required"`.

> *Rationale: Straightforward param rename. No logic changes.*

### D16. React `PurchaseInfo.agentName` -> `PurchaseInfo.productName`

All React types and components:

| Current | New |
|---|---|
| `PurchaseInfo.agentName` | `PurchaseInfo.productName` |
| `useCheckout(planRef, agentRef?)` | `useCheckout(planRef, productRef?)` |
| `PaymentFormProps.agentRef` | `PaymentFormProps.productRef` |
| `PlanSelectorProps.agentRef` | `PlanSelectorProps.productRef` |
| `UsePlansOptions.agentRef` | `UsePlansOptions.productRef` |
| `SolvaPayContextValue.createPayment({ agentRef? })` | `SolvaPayContextValue.createPayment({ productRef? })` |
| `SolvaPayContextValue.processPayment({ agentRef })` | `SolvaPayContextValue.processPayment({ productRef })` |
| `SolvaPayProviderProps.processPayment({ agentRef })` | `SolvaPayProviderProps.processPayment({ productRef })` |

> *Rationale: React types must match server types. Clean rename throughout.*

### D17. `usePurchase` hook updates for long-lived purchases

The hook return shape stays structurally similar but uses updated `PurchaseInfo` (D10):

```typescript
interface PurchaseStatus {
  loading: boolean
  customerRef?: string
  email?: string
  name?: string
  purchases: PurchaseInfo[]           // updated type
  hasPlan: (planName: string) => boolean
  activePurchase: PurchaseInfo | null
  hasPaidPurchase: boolean
  activePaidPurchase: PurchaseInfo | null
}
```

No new hooks required in v1. `usePayments()` is phase 2 — integrators can use `solvaPay.listPayments()` directly for now.

> *Rationale: The hook shape is still correct for the new model. Long-lived purchases just have richer data. A payment history hook can be added when there's demand.*

### D18. Next.js helpers rename `agentRef` -> `productRef`

| Current | New |
|---|---|
| `createPaymentIntent(req, { planRef, agentRef })` | `createPaymentIntent(req, { planRef, productRef })` |
| `processPayment(req, { paymentIntentId, agentRef })` | `processPayment(req, { paymentIntentId, productRef })` |
| `createCheckoutSession(req, { agentRef, planRef? })` | `createCheckoutSession(req, { productRef, planRef? })` |
| `listPlans` returns `{ plans, agentRef }` | returns `{ plans, productRef }` |
| `PurchaseCheckResult.purchases[].agentName` | `PurchaseCheckResult.purchases[].productName` |

Cache key strategy unchanged — still `userId`-based. Cache invalidation points stay the same (after createPaymentIntent, processPayment, cancelRenewal).

> *Rationale: Param renames propagate from Core helpers. Cache layer is user-scoped, unaffected by entity rename.*

### D19. `@solvapay/auth` requires no changes

Auth adapters (`AuthAdapter`, `SupabaseAuthAdapter`, `MockAuthAdapter`, `SolvapayAuthAdapter`) deal with user identity extraction, not product/agent references. No changes needed.

> *Rationale: Auth is entity-agnostic. It extracts user IDs from tokens/sessions, independent of what the user purchases.*

### D20. `@solvapay/react-supabase` requires no changes

The `createSupabaseAuthAdapter` wraps Supabase auth. It returns an `AuthAdapter` for token/userId extraction. No product/agent references exist in this package.

> *Rationale: Same as D19. Auth adapter, not entity-aware.*

### D21. `@solvapay/core` requires minimal changes

Only change: remove `version` export if unused, or update it. No agent references exist in `@solvapay/core` today.

> *Rationale: Core package contains config, error class, and env validation. None reference agents.*

### D22. Generated types regenerate automatically

After the backend deploys new OpenAPI spec (with `/v1/sdk/products` routes replacing `/v1/sdk/agents`), run `pnpm generate:types` to regenerate `packages/server/src/types/generated.ts`. All `AgentSdkController_*` operation names, `CreateAgentRequest` schemas, and `/v1/sdk/agents` paths will be replaced automatically.

**Sequencing:** Backend API must deploy first. Then SDK regenerates types. Then hand-written SDK code updates to reference new generated types.

> *Rationale: generated.ts is auto-produced from OpenAPI. The change cascades from backend. No manual editing of generated.ts needed.*

### D23. Update all 5 example apps simultaneously

All examples are small and reference agent terminology. Update in one pass:

| Example | Changes |
|---|---|
| `express-basic` | `payable({ agent })` -> `payable({ product })`, env vars |
| `mcp-basic` | `payable({ agent })` -> `payable({ product })`, env vars |
| `checkout-demo` | agentRef in payment flow -> productRef |
| `hosted-checkout-demo` | agentRef in checkout flow -> productRef |
| `nextjs-openai-custom-gpt-actions` | agentRef in API routes -> productRef |

Also update `examples/shared/` if it contains shared config referencing agents.

> *Rationale: Examples are documentation. They must reflect the current API. Small enough to update in one pass.*

### D24. Purchase utility functions require no logic changes

`filterPurchases`, `getActivePurchases`, `getCancelledPurchasesWithEndDate`, `getMostRecentPurchase`, `getPrimaryPurchase`, `isPaidPurchase` — these operate on `PurchaseInfo[]` by checking `status`, `amount`, `startDate`, `cancelledAt`, `endDate`. None reference `agentName` in their logic.

The only change is the `PurchaseInfo` type they operate on (D10), which is a type-level change, not a logic change.

> *Rationale: Utility functions are entity-agnostic. They filter by status and dates, not by entity name.*

### D25. `ProcessPaymentResult` updated for new model

```typescript
interface ProcessPaymentResult {
  type: 'recurring' | 'one-time'
  purchase?: PurchaseInfo      // updated PurchaseInfo (D10)
  oneTimePurchase?: OneTimePurchaseInfo
  status: 'completed'
}
```

`OneTimePurchaseInfo.productRef` replaces any agent reference (currently has `productRef` already — no change needed there).

> *Rationale: ProcessPaymentResult already uses `productRef` in OneTimePurchaseInfo. The main update is that PurchaseInfo carries the new fields from D10.*

---

## Questions

### A. Public API Naming and Terminology

**Q1. What should the `payable()` auto-resolution fallback be when no `product`/`productRef` is provided?**

Current: falls back to `process.env.SOLVAPAY_AGENT`, then `package.json name`, then `'default-agent'`.

Options:
- a) `process.env.SOLVAPAY_PRODUCT` -> `'default-product'` (drop package.json detection)
- b) `process.env.SOLVAPAY_PRODUCT` -> throw error (require explicit config)
- c) `process.env.SOLVAPAY_PRODUCT` -> `package.json name` -> `'default-product'`

> *Recommendation: **(a)**. Env var fallback for single-product apps, explicit `productRef` for multi-product. Drop package.json detection — it was a cute hack but produces confusing product names. Don't throw — stub mode should still work for local dev without any config.*

**Q2. Should the SDK validate product reference format (`prod_*`) or accept any string?**

Options:
- a) Accept any string (flexible, works during development)
- b) Validate `prod_` prefix, warn on mismatch
- c) Validate `prod_` prefix, throw on mismatch

> *Recommendation: **(a)**. Accept any string. During development and testing, integrators may use arbitrary strings. The backend validates the reference — the SDK shouldn't duplicate validation. This also allows backward-compatible reference formats if the backend ever changes prefixes.*

**Q3. What should the `SOLVAPAY_PRODUCT` env var behavior be in the `payable.mcp()` adapter specifically?**

MCP servers often monetize a single product. Should the env var apply to all adapters equally, or should MCP have different defaults?

> *Recommendation: Same behavior across all adapters. `SOLVAPAY_PRODUCT` applies universally. No adapter-specific env var logic. The adapter is a framework choice, not a product identity choice.*

---

### B. Entity Model and Type System

**Q4. Should the SDK expose a `Product` type for CRUD operations, or only use `productRef` as an opaque string?**

Options:
- a) Expose `Product` type with full fields (`reference`, `name`, `description`, `status`, `planIds`, etc.)
- b) Only expose `productRef` as a string identifier — Product CRUD handled in dashboard only
- c) Expose a slim `ProductInfo` type (`reference`, `name`, `description`, `status`) for read-only listing

> *Recommendation: **(c)**. SDK integrators need to list their products (for admin dashboards, product selectors). Full CRUD is a dashboard concern. Expose `listProducts()` returning `ProductInfo[]` and `createProduct()`/`deleteProduct()` as optional management methods (same pattern as current agent methods). Keep the return type slim — no planIds, no balance, no isMcpPay.*

**Q5. Should `PurchaseInfo` include the `planSnapshot` from the backend, or keep the current flat fields?**

Backend stores `planSnapshot: { name, price, currency, planType, features, limits }` on each Purchase.

Options:
- a) Expose as nested `planSnapshot` matching backend
- b) Keep flat: `planName`, `amount`, `currency`, `planType` as top-level fields
- c) Both: flat convenience fields + optional `planSnapshot` for full access

> *Recommendation: **(b)**. Keep flat fields for simplicity. SDK integrators don't need the raw snapshot — they need `planName`, `amount`, `planType` at the top level for UI rendering. If someone needs features/limits, they can query the Plan directly. Flat fields are easier to destructure in React components.*

**Q6. How should usage data be exposed on `PurchaseInfo`?**

Backend Purchase has `usage: { used, quota, unit, periodStart, periodEnd, resetDate, overageUnits, overageCost, carriedOverUnits }`.

Options:
- a) Expose full usage subdocument
- b) Expose slim usage: `{ used, quota, unit, remaining }` (computed `remaining = quota - used`)
- c) Don't expose usage on PurchaseInfo — use a separate `useUsage()` hook

> *Recommendation: **(b)**. Slim usage with computed `remaining`. Integrators need "50 of 100 used, 50 remaining" for progress bars. Period dates, overage costs, and carryover are backend billing concerns, not SDK display concerns. If integrators need the full breakdown, they can query the backend API directly.*

**Q7. Should the SDK add a `PaymentInfo` type for the `listPayments` response?**

Options:
- a) Full `PaymentInfo` type matching backend Payment entity
- b) Slim type: `{ reference, type, amount, currency, status, paidAt, periodStart?, periodEnd? }`
- c) Return raw backend response (`Record<string, unknown>`)

> *Recommendation: **(b)**. Slim type. Integrators need reference, type (initial/renewal/refund), amount, status, and date for billing history UI. Stripe-specific fields (stripePaymentIntentId, clientSecret), retry logic, and ledger references are backend concerns.*

---

### C. SDK Architecture

**Q8. Should the backend API and SDK update be deployed simultaneously, or does the SDK need a compatibility window?**

Options:
- a) Simultaneous deploy — backend + SDK + examples all update together
- b) Backend deploys first with dual endpoints (old + new), SDK updates after
- c) SDK ships first with feature flag, backend deploys after

> *Recommendation: **(a)**. Simultaneous. No external users. Backend can deploy new endpoints and deprecate old ones in the same release. SDK regenerates types from new spec and updates in lockstep. Ship as one coordinated release.*

**Q9. Should generated types (`generated.ts`) be committed to the repo, or generated at build time?**

Currently committed. After the backend API changes, the generated file will have a large diff.

Options:
- a) Keep committing generated types (current pattern)
- b) Generate at build time only, gitignore the file

> *Recommendation: **(a)**. Keep committing. Committed types make diffs reviewable, work without backend access, and don't require build-time code generation. The large diff from this redesign is a one-time event.*

**Q10. What is the implementation order across packages?**

Options:
- a) Bottom-up: core -> server -> react -> next -> examples
- b) Server-first: server (types + client + paywall) -> next -> react -> core -> examples
- c) Types-first: regenerate generated.ts -> update server types -> update server impl -> update next -> update react -> examples

> *Recommendation: **(c)**. Types-first. The generated types from the backend OpenAPI spec drive everything downstream. Once `generated.ts` is updated, the hand-written types update to match, then implementations, then consumers. This is the natural dependency order.*

---

### D. React Package Specifics

**Q11. Should `useCheckout` change its function signature?**

Current: `useCheckout(planRef: string, agentRef?: string)`

Options:
- a) `useCheckout(planRef: string, productRef?: string)` — same positional args
- b) `useCheckout({ planRef: string, productRef?: string })` — options object
- c) `useCheckout(planRef: string, options?: { productRef?: string })` — hybrid

> *Recommendation: **(b)**. Options object. The current positional signature is fragile as we add more options. An options object is more extensible and self-documenting: `useCheckout({ planRef: 'pln_xxx', productRef: 'prod_xxx' })`.*

**Q12. Should `PurchaseGate` accept `productRef` in addition to (or instead of) `requirePlan`?**

Current: `<PurchaseGate requirePlan="Premium">`. Gates access by plan name.

Options:
- a) Keep `requirePlan` only — plan name is sufficient for gating
- b) Add `requireProduct` as an alternative — gate by product ownership regardless of plan
- c) Add both `requireProduct` and `requirePlan` — gate by product OR plan

> *Recommendation: **(c)**. Both. `requireProduct` gates "does the customer own this product at all?" (any active purchase). `requirePlan` gates "does the customer have this specific plan?". Both are valid use cases. `requireProduct` is the more common one in the new model.*

**Q13. Should `PaymentForm` require `productRef` or auto-detect from context?**

Current: `<PaymentForm planRef="pln_xxx" agentRef="agt_xxx" />`

Options:
- a) Require `productRef` prop explicitly
- b) Auto-detect from nearest `SolvaPayProvider` context, allow override via prop
- c) Require `productRef` but allow env var fallback

> *Recommendation: **(a)**. Require explicitly. PaymentForm is used in checkout flows where the product is known. Auto-detection adds indirection. Explicit is better than implicit for payment flows — you want to be sure which product you're charging for.*

---

### E. Paywall and Error Handling

**Q14. What should the paywall HTTP error response shape be?**

Current:
```json
{ "success": false, "error": "Payment required", "agent": "agt_xxx", "checkoutUrl": "...", "message": "..." }
```

Options:
- a) Same shape, rename `agent` to `product`
- b) Restructure: `{ "error": "payment_required", "product": "...", "checkoutUrl": "...", "details": "..." }`
- c) Use RFC 7807 Problem Details: `{ "type": "payment_required", "title": "...", "detail": "...", "product": "...", "checkoutUrl": "..." }`

> *Recommendation: **(a)**. Same shape, rename field. The current shape works. Don't over-engineer error responses during this rename pass. If error response format improvement is needed, do it as a separate effort.*

**Q15. Should `PaywallError.structuredContent` be renamed or restructured?**

Current `PaywallStructuredContent`:
```typescript
{ kind: 'payment_required', agent: string, checkoutUrl: string, message: string }
```

> *Recommendation: Rename `agent` -> `product`. Keep structure. `kind: 'payment_required'` is correct. `product` identifies which product triggered the paywall. `checkoutUrl` provides the redirect. No structural change needed.*

---

### F. Documentation and Examples

**Q16. Should the SDK docs in `docs/` be updated in this pass, or deferred?**

The `docs/` folder has getting-started guides, API references (generated by typedoc), and example overviews.

Options:
- a) Update guides and regenerate API docs in the same pass
- b) Regenerate API docs only (automatic from types), defer guide updates
- c) Defer all docs updates to a follow-up

> *Recommendation: **(b)**. API docs regenerate automatically. Guides reference `agent` terminology and need updating but are lower priority than working code. Update guides as a fast follow-up.*

**Q17. Should example apps demonstrate the new Payment entity, or just rename agent -> product?**

Options:
- a) Just rename agent -> product (minimum viable)
- b) Add payment history display to checkout-demo and hosted-checkout-demo
- c) Create a new example specifically for payment/billing management

> *Recommendation: **(a)** for this pass. Rename only. Payment history examples can be added when the `listPayments` API is stable and tested. Keep the scope of this refactor focused.*

---

## Status

**25 decisions made (D1-D25). 17 questions answered with recommendations (Q1-Q17).**

## Next Steps

1. **Coordinate backend API deployment** — new OpenAPI spec with `/v1/sdk/products` routes
2. **Regenerate `generated.ts`** from new backend spec
3. **Update `@solvapay/server`** — types, client, paywall, factory, helpers
4. **Update `@solvapay/next`** — helpers, cache types
5. **Update `@solvapay/react`** — types, hooks, components
6. **Update all 5 example apps**
7. **Regenerate API docs** via typedoc
8. **Publish `1.0.0-preview.19`**
