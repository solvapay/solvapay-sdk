# SDK Product Model Redesign Spec

## 1. Purpose

This spec defines the SDK refactoring required to support the Product-centric backend model:

- `Product` replaces Agent and MCP Server as the commercial entity referenced by the SDK.
- `Purchase` is a long-lived access relationship (one per customer per product).
- `Payment` is a new read-only entity for billing history (initial, renewal, usage charge, refund).
- `PaymentIntent` (the SolvaPay entity) is deprecated on the backend, absorbed into `Payment`. The SDK renames `createPaymentIntent` -> `createPayment` and `processPayment` -> `confirmPayment` to match.

Based on decisions D1-D25 and Q1-Q17 from the [SDK Redesign Questionnaire](./SDK_REDESIGN_QUESTIONNAIRE.md).

## 2. Scope

In scope:

- `@solvapay/server` — types, client, paywall, factory, adapters, helpers
- `@solvapay/react` — types, hooks, components
- `@solvapay/next` — helpers, cache types
- `@solvapay/core` — minimal (no agent references today)
- All 5 example apps + shared utilities
- API docs regeneration (typedoc)

Out of scope:

- `@solvapay/auth` — no agent references, no changes needed (D19)
- `@solvapay/react-supabase` — no agent references, no changes needed (D20)
- Backend schema/service implementation
- Guide/tutorial documentation (fast follow-up)
- New `usePayments()` React hook (phase 2)

## 3. Design Principles

- Product-first terminology: every external-facing API, type, param, and error message uses `product`/`productRef`.
- No legacy: zero deprecated aliases, no backward-compatible shims, no `agent` references anywhere.
- Explicit over implicit: drop package.json auto-detection for product resolution. Require explicit `productRef` or `SOLVAPAY_PRODUCT` env var.
- Flat types for integrators: `PurchaseInfo` exposes flat fields, not nested backend structures. The SDK is an ergonomic layer, not a 1:1 backend mirror.
- No legacy terminology: `createPaymentIntent`/`processPayment` renamed to `createPayment`/`confirmPayment` to match backend routes. The `PaymentIntent` entity no longer exists.

## 4. API Route Changes

The backend API routes change. The SDK client (`client.ts`) must update all URL paths and request body field names.

| Current route | New route | Body field changes |
|---|---|---|
| `GET /v1/sdk/agents` | `GET /v1/sdk/products` | — |
| `POST /v1/sdk/agents` | `POST /v1/sdk/products` | `CreateAgentRequest` -> `CreateProductRequest` |
| `PUT /v1/sdk/agents/{agentRef}` | `PUT /v1/sdk/products/{productRef}` | `UpdateAgentRequest` -> `UpdateProductRequest` |
| `DELETE /v1/sdk/agents/{agentRef}` | `DELETE /v1/sdk/products/{productRef}` | — |
| `GET /v1/sdk/agents/{agentRef}/plans` | `GET /v1/sdk/products/{productRef}/plans` | — |
| `POST /v1/sdk/agents/{agentRef}/plans` | `POST /v1/sdk/products/{productRef}/plans` | `agentRef` removed from body |
| `DELETE /v1/sdk/agents/{agentRef}/plans/{planRef}` | `DELETE /v1/sdk/products/{productRef}/plans/{planRef}` | — |
| `POST /v1/sdk/payment-intents` | `POST /v1/sdk/payments` | Renamed. `agentRef` -> `productRef` in body |
| `GET /v1/sdk/payment-intents` | `GET /v1/sdk/payments` | Renamed. List payments. |
| `GET /v1/sdk/payment-intents/{id}` | `GET /v1/sdk/payments/{id}` | Renamed. |
| `POST /v1/sdk/payment-intents/{id}/process` | `POST /v1/sdk/payments/{id}/confirm` | Renamed path + action. `agentRef` -> `productRef` in body |
| — (new) | `GET /v1/sdk/payments/purchase/{purchaseRef}` | New. Billing history for a purchase. |
| `POST /v1/sdk/limits` | `POST /v1/sdk/limits` (unchanged) | `agentRef`/`mcpServerRef` -> `productRef` |
| `POST /v1/sdk/usages` | `POST /v1/sdk/usages` (unchanged) | `agentRef` -> `productRef` |
| `POST /v1/sdk/checkout-sessions` | `POST /v1/sdk/checkout-sessions` (unchanged) | `agentRef` -> `productRef` |
| — (new) | `GET /v1/sdk/payments` | New endpoint for billing history |

## 5. Package-by-Package Changes

### 5.1 `@solvapay/server`

25 source files. 16 require changes.

#### 5.1.1 Types Layer

**`src/types/generated.ts`** — Auto-regenerate from new backend OpenAPI spec. No manual edits. All `AgentSdkController_*` operations, `CreateAgentRequest`/`UpdateAgentRequest` schemas, `/v1/sdk/agents` paths, `CheckLimitRequest.agentRef`/`.mcpServerRef`, `PurchaseResponse.agentRef`/`.agentName`, and `UsageEvent.agentRef` will update automatically.

**`src/types/client.ts`** — Hand-written `SolvaPayClient` interface.

Changes:

```typescript
// BEFORE
interface SolvaPayClient {
  checkLimits(params: components['schemas']['CheckLimitRequest']): Promise<LimitResponseWithPlan>
  trackUsage(params: components['schemas']['UsageEvent'] & { planRef: string }): Promise<void>
  listAgents?(): Promise<Array<{ reference: string; name: string; description?: string }>>
  createAgent?(params: components['schemas']['CreateAgentRequest']): Promise<{ reference: string; name: string }>
  deleteAgent?(agentRef: string): Promise<void>
  listPlans?(agentRef: string): Promise<Array<{ ... }>>
  createPlan?(params: components['schemas']['CreatePlanRequest'] & { agentRef: string }): Promise<{ ... }>
  deletePlan?(agentRef: string, planRef: string): Promise<void>
  createPaymentIntent?(params: { agentRef: string; planRef: string; customerRef: string; idempotencyKey?: string }): Promise<{ ... }>   // OLD
  processPayment?(params: { paymentIntentId: string; agentRef: string; customerRef: string; planRef?: string }): Promise<ProcessPaymentResult>   // OLD
  // ...
}

// AFTER
interface SolvaPayClient {
  checkLimits(params: components['schemas']['CheckLimitRequest']): Promise<LimitResponseWithPlan>
  trackUsage(params: components['schemas']['UsageEvent'] & { planRef: string }): Promise<void>
  listProducts?(): Promise<Array<{ reference: string; name: string; description?: string; status?: string }>>
  createProduct?(params: components['schemas']['CreateProductRequest']): Promise<{ reference: string; name: string }>
  deleteProduct?(productRef: string): Promise<void>
  listPlans?(productRef: string): Promise<Array<{ ... }>>
  createPlan?(params: components['schemas']['CreatePlanRequest'] & { productRef: string }): Promise<{ ... }>
  deletePlan?(productRef: string, planRef: string): Promise<void>
  createPayment?(params: { productRef: string; planRef: string; customerRef: string; idempotencyKey?: string }): Promise<{ ... }>
  confirmPayment?(params: { paymentId: string; productRef: string; customerRef: string; planRef?: string }): Promise<ConfirmPaymentResult>
  listPayments?(params: { purchaseRef?: string; productRef?: string; customerRef?: string }): Promise<Array<PaymentInfo>>
  // ...
}
```

Add new `PaymentInfo` type:

```typescript
interface PaymentInfo {
  reference: string
  type: 'initial' | 'renewal' | 'one_time' | 'usage_charge' | 'refund'
  amount: number
  currency: string
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded'
  paidAt?: string
  periodStart?: string
  periodEnd?: string
}
```

**`src/types/options.ts`** — `PayableOptions` field renames.

```typescript
// BEFORE
interface PayableOptions {
  agent?: string
  agentRef?: string
  plan?: string
  planRef?: string
  getCustomerRef?: (context: any) => string | Promise<string>
}

// AFTER
interface PayableOptions {
  product?: string
  productRef?: string
  plan?: string
  planRef?: string
  getCustomerRef?: (context: any) => string | Promise<string>
}
```

**`src/types/paywall.ts`** — Rename `agent` field.

```typescript
// BEFORE
interface PaywallMetadata {
  agent?: string
  plan?: string
}
interface PaywallStructuredContent {
  kind: 'payment_required'
  agent: string
  checkoutUrl: string
  message: string
}

// AFTER
interface PaywallMetadata {
  product?: string
  plan?: string
}
interface PaywallStructuredContent {
  kind: 'payment_required'
  product: string
  checkoutUrl: string
  message: string
}
```

**`src/types/index.ts`** — No structural changes (re-exports only). Verify re-exports still resolve after renames.

#### 5.1.2 Client Implementation

**`src/client.ts`** — HTTP client. All API route URLs and request body field names update.

| Method | URL change | Body/param change |
|---|---|---|
| `listAgents()` -> `listProducts()` | `/v1/sdk/agents` -> `/v1/sdk/products` | response mapping: `agents` -> `products` |
| `createAgent()` -> `createProduct()` | `/v1/sdk/agents` -> `/v1/sdk/products` | — |
| `deleteAgent(agentRef)` -> `deleteProduct(productRef)` | `/v1/sdk/agents/{ref}` -> `/v1/sdk/products/{ref}` | — |
| `listPlans(agentRef)` -> `listPlans(productRef)` | `/v1/sdk/agents/{ref}/plans` -> `/v1/sdk/products/{ref}/plans` | — |
| `createPlan({ agentRef })` -> `createPlan({ productRef })` | `/v1/sdk/agents/{ref}/plans` -> `/v1/sdk/products/{ref}/plans` | `params.agentRef` -> `params.productRef` in URL |
| `deletePlan(agentRef, planRef)` -> `deletePlan(productRef, planRef)` | `/v1/sdk/agents/{ref}/plans/{planRef}` -> `/v1/sdk/products/{ref}/plans/{planRef}` | — |
| `createPaymentIntent` -> `createPayment` | `/v1/sdk/payment-intents` -> `/v1/sdk/payments` | body: `agentRef` -> `productRef` |
| `processPayment` -> `confirmPayment` | `/v1/sdk/payment-intents/{id}/process` -> `/v1/sdk/payments/{id}/confirm` | body: `agentRef` -> `productRef`, `paymentIntentId` -> `paymentId` |
| `checkLimits` | URL unchanged | body field change cascades from generated types |
| `trackUsage` | URL unchanged | body field change cascades from generated types |

New method: `listPayments` — `GET /v1/sdk/payments?purchaseRef=X&productRef=X&customerRef=X`

Error messages: `"List agents failed"` -> `"List products failed"`, etc.
JSDoc example: `client.listAgents()` -> `client.listProducts()`

#### 5.1.3 Paywall

**`src/paywall.ts`** — Internal paywall engine.

| Change | Location |
|---|---|
| `resolveAgent(metadata)` -> `resolveProduct(metadata)` | private method |
| `metadata.agent` -> `metadata.product` | in `resolveProduct()` |
| `process.env.SOLVAPAY_AGENT` -> `process.env.SOLVAPAY_PRODUCT` | in `resolveProduct()` |
| `getPackageJsonName()` fallback | **Remove entirely** (D14) |
| `'default-agent'` fallback -> `'default-product'` | in `resolveProduct()` |
| `const agent = this.resolveAgent(metadata)` -> `const product = this.resolveProduct(metadata)` | in `protect()` |
| `agentRef: agent` -> `productRef: product` | in `checkLimits()` call |
| `this.trackUsage(ref, agent, ...)` -> `this.trackUsage(ref, product, ...)` | in `protect()` |
| `trackUsage(customerRef, agentRef, ...)` -> `trackUsage(customerRef, productRef, ...)` | method signature + body |
| `agentRef` in `apiClient.trackUsage()` call -> `productRef` | in `trackUsage()` |
| `PaywallError` structured content: `agent` -> `product` | in `protect()` throw |
| `handleHttpError`: `agent: error.structuredContent.agent` -> `product: error.structuredContent.product` | error handler |
| `handleNextError`: same rename | error handler |
| `createPaywall()` function and its internal helpers: same renames | bottom of file |

#### 5.1.4 Factory

**`src/factory.ts`** — `createSolvaPay()` and interfaces.

| Change | Location |
|---|---|
| `SolvaPay` interface: all `agentRef` params -> `productRef` | interface definition |
| Add `listPayments` method to `SolvaPay` interface | interface definition |
| `payable()` implementation: `options.agentRef \|\| options.agent` -> `options.productRef \|\| options.product` | `payable()` function |
| `process.env.SOLVAPAY_AGENT` -> `process.env.SOLVAPAY_PRODUCT` | `payable()` function |
| Remove `getPackageJsonName()` call and function | `payable()` + helper function |
| `'default-agent'` -> `'default-product'` | `payable()` fallback |
| `const metadata = { agent, plan }` -> `const metadata = { product, plan }` | `payable()` function |
| JSDoc examples: all `agent: 'agt_xxx'` -> `product: 'prod_xxx'` | all JSDoc blocks |
| `createPaymentIntent` -> `createPayment` in implementation | convenience method (renamed) |
| `processPayment` -> `confirmPayment` in implementation | convenience method (renamed) |
| `checkLimits` params in implementation | convenience method |
| `trackUsage` params in implementation | convenience method |
| `createCheckoutSession` params in implementation | convenience method |
| Add `listPayments` implementation | convenience method |

#### 5.1.5 Helpers (Core route helpers)

**`src/helpers/payment.ts`** (rename file to `src/helpers/payment.ts` — stays same name, content changes):
- `createPaymentIntentCore` -> `createPaymentCore`: `body.agentRef` -> `body.productRef`, URL `/v1/sdk/payment-intents` -> `/v1/sdk/payments`, validation message, JSDoc
- `processPaymentCore` -> `confirmPaymentCore`: `body.agentRef` -> `body.productRef`, `body.paymentIntentId` -> `body.paymentId`, URL `/process` -> `/confirm`, validation message, JSDoc

**`src/helpers/checkout.ts`**:
- `createCheckoutSessionCore`: `body.agentRef` -> `body.productRef`, validation message

**`src/helpers/plans.ts`**:
- `listPlansCore`: `agentRef` query param -> `productRef`, return shape `{ plans, agentRef }` -> `{ plans, productRef }`, validation message

**`src/helpers/customer.ts`**: No agent references. No changes.
**`src/helpers/auth.ts`**: No agent references. No changes.
**`src/helpers/renewal.ts`**: No agent references (uses `purchaseRef`). No changes.
**`src/helpers/error.ts`**: No agent references. No changes.
**`src/helpers/types.ts`**: No agent references. No changes.
**`src/helpers/index.ts`**: Re-exports only. No changes.

#### 5.1.6 Adapters

**`src/adapters/base.ts`**: No direct agent references — receives `PaywallMetadata` which is updated in types. No code changes needed.
**`src/adapters/http.ts`**: Same — adapter logic is entity-agnostic. No changes.
**`src/adapters/next.ts`**: Same. No changes.
**`src/adapters/mcp.ts`**: Same. No changes.
**`src/adapters/index.ts`**: Re-exports. No changes.

#### 5.1.7 Other

**`src/index.ts`**: Re-exports only. Type names don't change (e.g., `PayableOptions` stays `PayableOptions`). No changes unless export names change.

**`src/edge.ts`**: Edge runtime webhook verification. No agent references. No changes.

**`src/utils.ts`**: `withRetry` and `createRequestDeduplicator`. No agent references. No changes.

#### 5.1.8 Server package file summary

| File | Change type |
|---|---|
| `src/types/generated.ts` | Regenerate (auto) |
| `src/types/client.ts` | Rename methods + params, add `PaymentInfo`, add `listPayments` |
| `src/types/options.ts` | Rename `agent`/`agentRef` fields |
| `src/types/paywall.ts` | Rename `agent` field |
| `src/client.ts` | Rename methods, URLs, body fields, error messages |
| `src/paywall.ts` | Rename `resolveAgent`, metadata, error content, trackUsage |
| `src/factory.ts` | Rename interface params, payable resolution, add listPayments |
| `src/helpers/payment.ts` | Rename params, validation messages |
| `src/helpers/checkout.ts` | Rename params, validation messages |
| `src/helpers/plans.ts` | Rename query param, return shape |
| `src/types/index.ts` | Verify re-exports (no structural change) |
| `src/index.ts` | Verify re-exports (no structural change) |
| `src/edge.ts` | No changes |
| `src/utils.ts` | No changes |
| `src/adapters/*.ts` | No changes (5 files) |
| `src/helpers/auth.ts` | No changes |
| `src/helpers/customer.ts` | No changes |
| `src/helpers/renewal.ts` | No changes |
| `src/helpers/error.ts` | No changes |
| `src/helpers/types.ts` | No changes |

**10 files modified, 1 file regenerated, 14 files unchanged.**

---

### 5.2 `@solvapay/react`

20 source files. 10 require changes.

#### 5.2.1 Types

**`src/types/index.ts`**:

Update `PurchaseInfo`:

```typescript
// BEFORE
interface PurchaseInfo {
  reference: string
  planName: string
  agentName: string
  status: string
  startDate: string
  endDate?: string
  cancelledAt?: string
  cancellationReason?: string
  amount?: number
}

// AFTER
interface PurchaseInfo {
  reference: string
  planName: string
  productName: string
  productReference: string
  status: 'pending' | 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired' | 'suspended' | 'refunded'
  planType: 'recurring' | 'usage-based' | 'one-time' | 'hybrid'
  isRecurring: boolean
  startDate: string
  endDate?: string
  nextBillingDate?: string
  billingCycle?: string
  cancelledAt?: string
  cancellationReason?: string
  amount?: number
  currency?: string
  usage?: {
    used: number
    quota: number | null
    unit: string
    remaining: number | null
  }
}
```

Update `SolvaPayContextValue`:
- `createPayment: (params: { planRef: string; agentRef?: string })` -> `createPayment: (params: { planRef: string; productRef?: string })`
- `processPayment?: (params: { paymentIntentId: string; agentRef: string; planRef?: string })` -> `confirmPayment?: (params: { paymentId: string; productRef: string; planRef?: string })`

Update `SolvaPayProviderProps`:
- Same `processPayment` -> `confirmPayment` rename

Update `PaymentFormProps`:
- `agentRef?: string` -> `productRef?: string`

Update `PlanSelectorProps`:
- `agentRef?: string` -> `productRef?: string`

Update `UsePlansOptions`:
- `agentRef?: string` -> `productRef?: string`
- `fetcher: (agentRef: string) => Promise<Plan[]>` -> `fetcher: (productRef: string) => Promise<Plan[]>`

Update `PurchaseGateProps`:
- Add `requireProduct?: string` alongside existing `requirePlan?: string`

Export new type alias:
```typescript
type PurchaseStatusValue = 'pending' | 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired' | 'suspended' | 'refunded'
```

#### 5.2.2 Hooks

**`src/hooks/useCheckout.ts`**: Change from positional args to options object:
- `useCheckout(planRef: string, agentRef?: string)` -> `useCheckout(options: { planRef: string; productRef?: string })`
- Internal API call params update accordingly

**`src/hooks/usePlans.ts`**: `agentRef` -> `productRef` in options destructuring and `fetcher()` call.

**`src/hooks/usePurchase.ts`**: No direct agent references in hook logic. `PurchaseInfo` type update cascades. Verify no hardcoded field access to `agentName`.

**`src/hooks/usePurchaseStatus.ts`**: No direct agent references. Type cascade only.

**`src/hooks/useCustomer.ts`**: No agent references. No changes.

**`src/hooks/useSolvaPay.ts`**: No agent references (wraps context). No changes.

#### 5.2.3 Components

**`src/PaymentForm.tsx`**: `agentRef` prop -> `productRef` prop. Internal `useCheckout` call updates.

**`src/SolvaPayProvider.tsx`**: `createPayment`/`confirmPayment` param types cascade from `SolvaPayContextValue`. Internal API call body: `agentRef` -> `productRef`.

**`src/components/PurchaseGate.tsx`**: Add `requireProduct` prop logic alongside existing `requirePlan`.

**`src/components/PlanSelector.tsx`**: `agentRef` prop -> `productRef` prop in `usePlans` call.

**`src/components/PlanBadge.tsx`**: No agent references. No changes.
**`src/components/Spinner.tsx`**: No changes.
**`src/components/StripePaymentFormWrapper.tsx`**: No agent references. No changes.

#### 5.2.4 Utils

**`src/utils/purchases.ts`**: No logic changes (D24). Type cascades only.

#### 5.2.5 Tests

**`src/hooks/__tests__/usePurchase.test.tsx`**: Update mock data `agentName` -> `productName`, add new fields.
**`src/hooks/__tests__/usePurchaseStatus.test.tsx`**: Same mock data updates.
**`src/utils/__tests__/purchases.test.ts`**: Same mock data updates.

#### 5.2.6 React package file summary

| File | Change type |
|---|---|
| `src/types/index.ts` | Rename fields, add fields to PurchaseInfo, add PurchaseGateProps.requireProduct |
| `src/hooks/useCheckout.ts` | Change to options object signature, rename agentRef |
| `src/hooks/usePlans.ts` | Rename agentRef |
| `src/PaymentForm.tsx` | Rename agentRef prop |
| `src/SolvaPayProvider.tsx` | Rename agentRef in API call params |
| `src/components/PurchaseGate.tsx` | Add requireProduct prop |
| `src/components/PlanSelector.tsx` | Rename agentRef prop |
| `src/hooks/__tests__/usePurchase.test.tsx` | Update mock data |
| `src/hooks/__tests__/usePurchaseStatus.test.tsx` | Update mock data |
| `src/utils/__tests__/purchases.test.ts` | Update mock data |
| `src/index.tsx` | Verify exports (no structural change) |
| `src/hooks/usePurchase.ts` | Verify no hardcoded agentName access |
| All other files | No changes |

**10 files modified, 10 files unchanged.**

---

### 5.3 `@solvapay/next`

12 source files. 5 require changes.

**`src/helpers/payment.ts`**:
- `createPaymentIntent` -> `createPayment(request, body: { planRef, productRef })`
- `processPayment` -> `confirmPayment(request, body: { paymentId, productRef })`
- Validation messages and JSDoc

**`src/helpers/checkout.ts`**:
- `createCheckoutSession(request, body: { agentRef })` -> `body: { productRef }`
- Validation messages

**`src/helpers/plans.ts`**:
- `listPlans` reads `agentRef` from URL -> reads `productRef`
- Return shape: `{ plans, agentRef }` -> `{ plans, productRef }`

**`src/cache.ts`**:
- `PurchaseCheckResult.purchases[].agentName` -> `.productName`
- Add new fields to match updated `PurchaseInfo` (D10)

**`src/index.ts`**: Verify re-exports. No structural changes.

Files unchanged: `helpers/auth.ts`, `helpers/customer.ts`, `helpers/renewal.ts`, `helpers/middleware.ts`, `helpers/index.ts`, `templates/middleware-next15.ts`, `templates/middleware-next16.ts`.

**4 files modified, 1 file verified, 7 files unchanged.**

---

### 5.4 `@solvapay/core`

No agent references. No changes required (D21). Verify only.

---

### 5.5 `@solvapay/auth` and `@solvapay/react-supabase`

No changes required (D19, D20).

---

### 5.6 Examples

30+ files across 5 examples. All changes are `agent` -> `product` renames in env vars, config, API call params, and test fixtures.

**`examples/shared/stub-api-client.ts`**: Rename `agentRef` params, update method names (listAgents -> listProducts, etc.)

**`examples/express-basic/src/index.ts`**: `payable({ agent: '...' })` -> `payable({ product: '...' })`

**`examples/mcp-basic/`**: `src/config.ts` and `src/types/mcp.ts` — rename agent config. Test files update fixtures.

**`examples/checkout-demo/`**:
- `.env` and `env.example`: `NEXT_PUBLIC_AGENT_REF` -> `NEXT_PUBLIC_PRODUCT_REF`
- `app/page.tsx`: read new env var
- `app/checkout/page.tsx`: update context
- `app/checkout/components/PaymentFormSection.tsx`, `StyledPaymentForm.tsx`: `agentRef` prop -> `productRef`
- `app/api/create-payment-intent/route.ts` -> rename to `app/api/create-payment/route.ts`: body `agentRef` -> `productRef`, call `createPayment` instead of `createPaymentIntent`
- `app/api/process-payment/route.ts` -> rename to `app/api/confirm-payment/route.ts`: body `agentRef` -> `productRef`, call `confirmPayment` instead of `processPayment`

**`examples/hosted-checkout-demo/`**:
- `.env` and `env.example`: `NEXT_PUBLIC_AGENT_REF` -> `NEXT_PUBLIC_PRODUCT_REF`
- `app/page.tsx`, `app/components/Navigation.tsx`: read new env var, update API body
- `app/api/create-checkout-session/route.ts`: body `agentRef` -> `productRef`

**`examples/nextjs-openai-custom-gpt-actions/`**: Heaviest changes (13 files).
- `.env.local`, `.env.dev`, `env.example`: `NEXT_PUBLIC_AGENT_REF` -> `NEXT_PUBLIC_PRODUCT_REF`
- `package.json`: `setup:env` script `SOLVAPAY_AGENT` -> `SOLVAPAY_PRODUCT`
- `cloudbuild-dev.yaml`: build arg rename
- `src/lib/schemas/index.ts`: zod schema `agent` field -> `product`
- `src/app/api/tasks/route.ts`, `[id]/route.ts`: param renames
- `src/app/api/create-checkout-session/route.ts`: body rename
- Test files: fixture and assertion updates

## 6. New Types Summary

Types introduced by this refactoring:

```typescript
// New type in @solvapay/server (src/types/client.ts)
interface PaymentInfo {
  reference: string
  type: 'initial' | 'renewal' | 'one_time' | 'usage_charge' | 'refund'
  amount: number
  currency: string
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded'
  paidAt?: string
  periodStart?: string
  periodEnd?: string
}

// New type alias in @solvapay/react (src/types/index.ts)
type PurchaseStatusValue = 'pending' | 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired' | 'suspended' | 'refunded'

// New fields on PurchaseInfo in @solvapay/react
interface PurchaseInfo {
  // ... existing fields (reference, planName, status, startDate, etc.)
  productName: string           // renamed from agentName
  productReference: string      // new
  planType: string              // new
  isRecurring: boolean          // new
  nextBillingDate?: string      // new
  billingCycle?: string         // new
  currency?: string             // new
  usage?: {                     // new
    used: number
    quota: number | null
    unit: string
    remaining: number | null
  }
}

// Updated PurchaseGateProps in @solvapay/react
interface PurchaseGateProps {
  requirePlan?: string          // existing
  requireProduct?: string       // new
  children: (props: { hasAccess: boolean; purchases: PurchaseInfo[]; loading: boolean }) => React.ReactNode
}
```

## 7. Implementation Phases

### Phase 1: Types and Generated Code

**Prerequisite:** Backend deploys new OpenAPI spec with `/v1/sdk/products` routes.

1. Regenerate `packages/server/src/types/generated.ts` via `pnpm generate:types`
2. Update `packages/server/src/types/client.ts` — rename methods, add `PaymentInfo`, add `listPayments`
3. Update `packages/server/src/types/options.ts` — rename fields
4. Update `packages/server/src/types/paywall.ts` — rename fields
5. Build server types to verify compilation: `cd packages/server && pnpm build`

### Phase 2: Server Implementation

6. Update `packages/server/src/client.ts` — URLs, body fields, method names, error messages
7. Update `packages/server/src/paywall.ts` — resolveProduct, metadata, error content
8. Update `packages/server/src/factory.ts` — interface, payable(), convenience methods, remove getPackageJsonName
9. Update `packages/server/src/helpers/payment.ts` — params
10. Update `packages/server/src/helpers/checkout.ts` — params
11. Update `packages/server/src/helpers/plans.ts` — query param, return shape
12. Full server build + existing tests: `cd packages/server && pnpm build && pnpm test`

### Phase 3: Next.js Package

13. Update `packages/next/src/helpers/payment.ts` — params
14. Update `packages/next/src/helpers/checkout.ts` — params
15. Update `packages/next/src/helpers/plans.ts` — query param, return shape
16. Update `packages/next/src/cache.ts` — PurchaseCheckResult type
17. Build: `cd packages/next && pnpm build`

### Phase 4: React Package

18. Update `packages/react/src/types/index.ts` — PurchaseInfo, props, context types
19. Update `packages/react/src/hooks/useCheckout.ts` — options object signature
20. Update `packages/react/src/hooks/usePlans.ts` — rename
21. Update `packages/react/src/PaymentForm.tsx` — prop rename
22. Update `packages/react/src/SolvaPayProvider.tsx` — API params
23. Update `packages/react/src/components/PurchaseGate.tsx` — add requireProduct
24. Update `packages/react/src/components/PlanSelector.tsx` — prop rename
25. Update test files (3 files) — mock data
26. Build: `cd packages/react && pnpm build`

### Phase 5: Examples

27. Update `examples/shared/stub-api-client.ts`
28. Update `examples/express-basic/`
29. Update `examples/mcp-basic/`
30. Update `examples/checkout-demo/`
31. Update `examples/hosted-checkout-demo/`
32. Update `examples/nextjs-openai-custom-gpt-actions/`
33. Verify all examples build

### Phase 6: Docs and Release

34. Regenerate API docs: `pnpm typedoc`
35. Bump version to `1.0.0-preview.19`
36. Full monorepo build: `pnpm build`
37. Full test suite: `pnpm test`
38. Publish

## 8. Acceptance Criteria

- Zero references to `agent`, `agentRef`, `agentName`, `SOLVAPAY_AGENT`, `agt_` across all source files (excluding `generated.ts` pre-regeneration and git history).
- All packages compile without errors.
- All existing tests pass with updated fixtures.
- `createSolvaPay().payable({ product: 'prod_xxx' })` works across all adapters (http, next, mcp, function).
- `SolvaPayClient.listProducts()`, `.createProduct()`, `.deleteProduct()` call correct backend routes.
- `SolvaPayClient.listPayments()` calls new backend endpoint.
- `checkLimits({ customerRef, productRef })` sends single `productRef` (no agentRef/mcpServerRef branching).
- `PurchaseInfo` exposes `productName`, `productReference`, `planType`, `isRecurring`, `usage` fields.
- `PurchaseGate` supports both `requireProduct` and `requirePlan` props.
- `useCheckout` accepts options object: `useCheckout({ planRef, productRef })`.
- All 5 example apps build and reference `NEXT_PUBLIC_PRODUCT_REF` / `SOLVAPAY_PRODUCT`.

## 9. Risks and Mitigations

- **Risk:** Backend OpenAPI spec not ready when SDK work begins.
  - **Mitigation:** Phase 1 (type regeneration) blocks on backend. Phases 2-5 can be prepared with manually stubbed types if needed, then verified after regeneration.

- **Risk:** Backend route naming doesn't match expected patterns.
  - **Mitigation:** Coordinate route names before implementation. The `client.ts` URL strings are the single point of coupling.

- **Risk:** Generated types have unexpected shapes after regeneration.
  - **Mitigation:** Review `generated.ts` diff before updating hand-written types. Auto-generation is deterministic — one review pass is sufficient.

- **Risk:** Examples break due to env var renames.
  - **Mitigation:** Grep all `.env*` files for `AGENT` and update. Small surface area.
