---
name: Frontend Product Model Redesign
overview: Implement the frontend product model redesign in 6 phases, starting with types/schemas, then foundation/IA, product CRUD, purchases, checkout/customer surfaces, and finally dashboard/admin/migration polish.
todos:
  - id: phase-0a
    content: 'Phase 0A: Create src/types/enums.ts with all shared domain enums (ProductStatus, PurchaseStatus, PlanType, BillingCycle, etc.)'
    status: completed
  - id: phase-0b
    content: 'Phase 0B: Create src/types/product.ts with Product, CreateProductRequest, UpdateProductRequest, GetProductsOptions'
    status: completed
  - id: phase-0c
    content: 'Phase 0C: Rewrite src/types/purchase.ts -- replace agent/MCP refs with product refs, add subscription and usage fields'
    status: completed
  - id: phase-0d
    content: 'Phase 0D: Update src/types/plans.ts -- remove PlanAgent/PlanMcpServer/PlanMcpTool, add productId/productReference, use shared enums'
    status: completed
  - id: phase-0e
    content: 'Phase 0E: Update src/types/transaction.ts -- replace agent refs with product refs, update entity types'
    status: completed
  - id: phase-0f
    content: 'Phase 0F: Update src/types/account.ts -- replace agent/mcp entity type with product'
    status: completed
  - id: phase-0g
    content: 'Phase 0G: Delete src/types/agent.ts and fix all imports'
    status: cancelled
  - id: phase-0h
    content: 'Phase 0H: Create src/schemas/ with Zod schemas: product.schema.ts, plan.schema.ts, purchase.schema.ts, shared.schema.ts'
    status: completed
  - id: phase-0i
    content: 'Phase 0I: Write tests for all Zod schemas in src/schemas/__tests__/'
    status: completed
  - id: phase-1a
    content: 'Phase 1A: Update src/router/next-paths.ts with product routes, remove agent/MCP routes'
    status: completed
  - id: phase-1b
    content: 'Phase 1B: Update ProviderLayout sidebar navigation to spec (Products replaces Agents/MCP Pay, Transactions removed from primary)'
    status: completed
  - id: phase-1c
    content: 'Phase 1C: Create product query hooks (hooks/queries/products.ts) and update keys.ts'
    status: completed
  - id: phase-1d
    content: 'Phase 1D: Create useProducts.ts CRUD hook'
    status: completed
  - id: phase-1e
    content: 'Phase 1E: Update purchase query hooks for product-based filtering'
    status: completed
  - id: phase-1f
    content: 'Phase 1F: Update entity registry -- replace agent with product'
    status: completed
  - id: phase-1g
    content: 'Phase 1G: Add legacy route redirects (agents -> products, mcp-pay -> products)'
    status: completed
  - id: phase-1h
    content: 'Phase 1H: Write tests for product query hooks and route regression'
    status: completed
  - id: phase-2
    content: 'Phase 2: Product CRUD pages (list, create flow with type selector, edit with tabs), shared UI components, plan context integration'
    status: pending
  - id: phase-3
    content: 'Phase 3: Purchases redesign (list columns/filters, detail drawer with billing/usage/financial panels)'
    status: pending
  - id: phase-4
    content: 'Phase 4: Checkout migration (product terminology, plan comparison cards), customer detail/self-service updates'
    status: pending
  - id: phase-5
    content: 'Phase 5: Dashboard KPIs, developer docs, admin panel, transaction page updates, migration UX modal'
    status: pending
isProject: false
---

# Frontend Product Model Redesign Implementation Plan

## Current State Summary

The frontend currently uses **Agent** and **McpServer** as the primary commercial entities. There is no `Product` type. Plans double as both product definition and pricing. Purchases reference `agentId`/`mcpServerId`. Types live in `src/types/`, Zod schemas are inline in component files (not shared), and the data layer follows a 3-tier pattern: query hooks (`hooks/queries/`) -> CRUD hooks (`hooks/use*.ts`) -> components.

The backend refactor has already landed with:

- `Product` as the core entity (with `isMcpPay` flag for MCP Pay products)
- `Purchase` unified as the per-period billing record (no separate Subscription entity)
- Plans nested under Products (`/v1/sdk/products/:productRef/plans`)
- UI endpoints at `/v1/ui/products`, `/v1/ui/purchases` etc.

---

## Phase 0: Types, Enums, and Zod Schemas

Priority: **Highest** -- everything else depends on this.

### 0A. Create shared enums/constants

Create `[src/types/enums.ts](src/types/enums.ts)` with all domain enums extracted as string union types (matching backend exactly):

- `ProductStatus`: `'active' | 'inactive' | 'suspended'`
- `PurchaseStatus`: `'pending' | 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired' | 'suspended' | 'refunded'`
- `PlanStatus`: `'active' | 'inactive' | 'archived'`
- `PlanType`: `'recurring' | 'usage-based' | 'one-time' | 'hybrid'`
- `BillingCycle`: `'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'`
- `BillingModel`: `'pre-paid' | 'post-paid'`
- `TransactionStatus`: `'initiated' | 'completed' | 'pending' | 'failed' | 'processing' | 'cancelled'`
- `EntityType`: `'product' | 'plan' | 'customer' | 'transaction' | 'purchase'`

### 0B. Create Product types

Create `[src/types/product.ts](src/types/product.ts)` matching the backend `Product` schema and DTOs:

```typescript
export interface Product {
  id: string
  reference: string
  name: string
  description?: string
  avatarUrl?: string
  productType?: string
  status: ProductStatus
  balance: number
  totalTransactions: number
  isMcpPay: boolean
  config?: ProductConfig
  metadata?: Record<string, unknown>
  plans?: Plan[]
  createdAt: string
  updatedAt: string
}

export interface ProductConfig {
  fulfillmentType?: string
  validityPeriod?: number
  deliveryMethod?: string
}

export interface CreateProductRequest {
  name: string
  description?: string
  avatarUrl?: string
  productType?: string
  isMcpPay?: boolean
  config?: ProductConfig
  metadata?: Record<string, unknown>
}

export interface UpdateProductRequest extends Partial<CreateProductRequest> {
  status?: ProductStatus
}

export interface GetProductsOptions {
  limit?: number
  offset?: number
  search?: string
  status?: string
  isMcpPay?: boolean
}
```

### 0C. Update Purchase types

Rewrite `[src/types/purchase.ts](src/types/purchase.ts)` to match the backend `Purchase` schema -- replace `agentId`/`mcpServerId` with `productId`/`productReference`, add subscription fields (`isRecurring`, `billingCycle`, `nextBillingDate`, `autoRenew`), usage fields, and `planSnapshot`:

Key changes:

- Remove: `agentId`, `agentReference`, `agentName`, `mcpServerId`, `mcpServerReference`, `mcpServerName`
- Add: `productId`, `productReference`, `planSnapshot`, `isRecurring`, `billingCycle`, `nextBillingDate`, `autoRenew`, `usage`, `trialEndDate`, `retryCount`, `nextRetryAt`, `isFreeTier`, `requiresPayment`
- Update `GetPurchasesOptions`: replace `agentId` with `productId`, `customerId`
- Add `PurchaseDetailResponse` for the detail view

### 0D. Update Plan types

Update `[src/types/plans.ts](src/types/plans.ts)`:

- Remove: `PlanAgent`, `PlanMcpServer`, `PlanMcpTool`, `PlanRelationships` (plans are now product-scoped)
- Add: `productId`, `productReference` to `Plan`
- Update `GetPlansOptions` to add `productId` filter
- Import enums from `enums.ts` instead of inline unions

### 0E. Update Transaction types

Update `[src/types/transaction.ts](src/types/transaction.ts)`:

- Replace `agentId`/`agentName`/`fromAgentId`/`toAgentId` with `productId`/`productName`/`fromEntityId`/`toEntityId`
- Update `fromEntityType`/`toEntityType` to use `'product' | 'provider' | 'solvapay' | 'unknown'` (remove `agent`, `mcp_tool`, `mcp_server`)
- Update `GetTransactionsOptions`: replace `entityId` with `productId`

### 0F. Update Account types

Update `[src/types/account.ts](src/types/account.ts)`:

- Replace `entityType: 'agent' | 'mcp_server'` with `entityType: 'product'`
- Update `GetAccountsOptions` accordingly

### 0G. Delete Agent types

Delete `[src/types/agent.ts](src/types/agent.ts)` -- all Agent functionality is now in `Product`. Update any remaining imports across the codebase.

### 0H. Create Zod validation schemas (shared)

Create a `src/schemas/` directory with extracted, testable Zod schemas:

- `[src/schemas/product.schema.ts](src/schemas/product.schema.ts)` -- `createProductSchema`, `updateProductSchema` (validates product form data before API submission)
- `[src/schemas/plan.schema.ts](src/schemas/plan.schema.ts)` -- extract from the inline schema currently in `components/provider/plans/PlanForm/index.tsx`, add `productId` as required field
- `[src/schemas/purchase.schema.ts](src/schemas/purchase.schema.ts)` -- `purchaseFilterSchema` (for filter validation), `cancelPurchaseSchema`
- `[src/schemas/shared.schema.ts](src/schemas/shared.schema.ts)` -- shared Zod validators: `currencySchema`, `statusSchemas`, `paginationSchema`, `billingCycleSchema`

### 0I. Tests for types and schemas

Create tests under `src/schemas/__tests__/`:

- `product.schema.test.ts` -- valid/invalid product creation payloads, edge cases for `isMcpPay`, config validation
- `plan.schema.test.ts` -- validate each plan type discriminator (recurring, usage-based, hybrid, one-time), required fields per type, billing cycle validation
- `purchase.schema.test.ts` -- filter schema validation, cancel purchase schema
- `shared.schema.test.ts` -- currency, pagination, status enum validators

---

## Phase 1: Foundation and IA (Routes, Navigation, API Layer)

### 1A. Update route constants

Rewrite `[src/router/next-paths.ts](src/router/next-paths.ts)`:

- Replace `providerAgents`/`providerMcpPay` with `providerProducts`
- Add product detail routes: `providerProductDetail(id)`, `providerEditProduct(id)`, `providerCreateProduct`
- Add product-scoped sub-routes: `/provider/products/[productId]/plans`, `/provider/products/[productId]/purchases`, etc.
- Keep plan routes at top level AND within product context
- Remove agent/MCP-specific routes

### 1B. Update sidebar navigation

Update `[src/layout/ProviderLayout.tsx](src/layout/ProviderLayout.tsx)` `navItems` to match the spec:

```
Home | Products | Plans | Wallet | Usage | --- | Customers | Purchases | --- | Notifications | Developers | Settings
```

Remove `Agents` and `MCP Pay` items. Remove `Transactions` from primary nav (contextual access only).

### 1C. Create Product query hooks

Create `[src/hooks/queries/products.ts](src/hooks/queries/products.ts)`:

- `fetchProducts(options)` / `useProductsQuery(options)`
- `fetchProduct(id)` / `useProductQuery(id)`

Update `[src/hooks/queries/keys.ts](src/hooks/queries/keys.ts)`:

- Add `productsKeys` factory (all, list, detail, stats)
- Remove `agentsKeys`
- Update `purchasesKeys` to support `productId` filter

### 1D. Create Product CRUD hook

Create `[src/hooks/useProducts.ts](src/hooks/useProducts.ts)`:

- CRUD methods: `getProducts`, `getProduct`, `createProduct`, `updateProduct`, `deleteProduct`
- Follow existing pattern from `useAgents.ts` but cleaner (consider using `useMutation` from React Query)

### 1E. Update Purchase query hooks

Update `[src/hooks/queries/purchases.ts](src/hooks/queries/purchases.ts)`:

- Replace `agentId` filter with `productId`, `customerId`
- Add `fetchPurchase(id)` / `usePurchaseQuery(id)` for detail view
- Add `fetchPurchasesByProduct(productId)` / `fetchPurchasesByCustomer(customerId)`

### 1F. Update entity registry

Update `[src/components/entity/registry/index.tsx](src/components/entity/registry/index.tsx)`:

- Replace `agent` with `product` in `EntityType` and registry map
- Create `ProductEntity` component (view/form/drawer modes)
- Remove `AgentEntity` import

### 1G. Create legacy route redirects

Create a Next.js middleware or redirect config for:

- `/provider/agents` -> `/provider/products`
- `/provider/mcp-pay` -> `/provider/products?type=mcp_pay`
- `/provider/agents/[id]` -> `/provider/products/[id]`

### 1H. Tests for Phase 1

- `src/hooks/queries/__tests__/products.test.ts` -- query hook tests (mock API, verify query keys)
- `src/hooks/__tests__/useProducts.cache.test.ts` -- CRUD cache invalidation tests
- `src/__tests__/provider/routeRegression.test.tsx` -- update existing route regression test for new paths

---

## Phase 2: Product CRUD Pages and Components

### 2A. Products list page

Create `[src/pages/provider/products/index.tsx](src/pages/provider/products/index.tsx)` and `[src/components/provider/products/ProductList/](src/components/provider/products/ProductList/)`:

- Card-based layout with type badge (`SDK` / `MCP Pay`)
- Filters: type, status, category, search
- Card content: avatar, name, type badge, status badge, metrics, quick actions

### 2B. Product create flow

Create `[src/pages/provider/products/create/index.tsx](src/pages/provider/products/create/index.tsx)` and components:

- Step 1: `ProductTypeSelector` -- choose SDK or MCP Pay
- Step 2A: `SdkProductForm` -- identity fields (name, description, categories, avatar)
- Step 2B: `McpPayProductForm` -- identity + MCP config (origin URL, auth, tool discovery, plan assignment)
- Post-create guidance prompt for first plan

### 2C. Product edit/detail page with tabs

Create `[src/pages/provider/products/[productId]/index.tsx](src/pages/provider/products/[productId]/index.tsx)`:

- Top: product identity card
- Tabs: Overview, Plans, Purchases, Transactions, Customers, Usage, MCP Config (conditional), Tools & Access (conditional)
- Each tab as a lazy-loaded component

### 2D. Shared UI components

Create in `src/components/shared/`:

- `ProductTypeIcon` -- SDK vs MCP Pay icon/badge
- `PurchaseStatusBadge` -- colored badge for purchase statuses
- `BillingPeriodIndicator` -- shows current billing period
- `UsageProgressBar` -- usage quota progress visualization
- `PlanComparisonCard` -- for checkout plan selection

### 2E. Plan context integration

Update plan create/edit to accept `productId` as context:

- Plan create from product context (`/provider/products/[productId]/plans` -> create button -> `/provider/plans/create?productId=...`)
- "Duplicate plan to another product" action

### 2F. Tests for Phase 2

- Component tests for `ProductTypeSelector`, `ProductList`, product forms
- Integration tests for create flow (type selection -> form -> submit)

---

## Phase 3: Purchases Redesign

### 3A. Purchase list page redesign

Update `[src/components/provider/purchases/](src/components/provider/purchases/)`:

- Columns: reference, status, product, customer, plan, plan type, usage indicator, next renewal, total paid, created
- Filters: status, product, plan type, past due
- "View Transactions" link in page header

### 3B. Purchase detail/drawer redesign

Update `[src/components/provider/purchases/PurchaseDrawer/](src/components/provider/purchases/PurchaseDrawer/)`:

- Identity panel with product + customer context
- Billing panel (billing history = list of Purchases for customer+product)
- Usage panel (conditional, for usage-based/hybrid)
- Financial summary with "Open related transactions" link
- Activity timeline
- Actions: cancel, pause, resume, upgrade

### 3C. Tests for Phase 3

- `PurchaseGrid` renders correct columns
- `PurchaseDrawer` renders all panels conditionally
- Filter state management tests

---

## Phase 4: Checkout and Customer Surfaces

### 4A. Checkout metadata migration

Update `[src/pages/customer/checkout/](src/pages/customer/checkout/)`:

- Replace all `agent` terminology with `product`
- Surface product branding
- Plan selection as pricing-card comparison
- MCP Pay: tool access preview, post-purchase connect instructions

### 4B. Customer detail updates

Update `[src/components/provider/customers/](src/components/provider/customers/)`:

- Show purchases grouped by product (billing history)
- Usage summary per purchase
- Deep links to product and purchase detail

### 4C. Customer self-service

Update `[src/pages/customer/manage/](src/pages/customer/manage/)`:

- Product terminology throughout
- Purchase management actions

### 4D. Tests for Phase 4

- Checkout flow renders product branding
- Customer detail shows per-product purchase grouping

---

## Phase 5: Dashboard, Developers, Admin, Migration Polish

### 5A. Home dashboard

Update `[src/components/provider/home/](src/components/provider/home/)`:

- Products KPI card (total/active/inactive)
- Recent purchases widget
- Product revenue breakdown

### 5B. Developers page

Update developer docs in app to reference `/products` model, updated event names.

### 5C. Admin panel

Update `[src/pages/admin/](src/pages/admin/)`:

- Replace Agents with Products
- Add Purchases views
- Provider drill-down should be product-first

### 5D. Transaction page updates

Update `[src/components/provider/transactions/](src/components/provider/transactions/)`:

- Show product name/type in entity cells (replace agent references)
- Add explainer copy distinguishing Transactions from Purchases
- Remove from primary sidebar (already done in Phase 1)

### 5E. Migration UX

- One-time migration summary modal (what changed, where things moved)
- Route redirects (implemented in Phase 1)
- Temporary compatibility badges/labels

### 5F. Tests for Phase 5

- Home dashboard KPI rendering
- Admin Products page
- Migration modal display logic

---

## File Impact Summary

**New files:**

- `src/types/product.ts`, `src/types/enums.ts`
- `src/schemas/product.schema.ts`, `src/schemas/plan.schema.ts`, `src/schemas/purchase.schema.ts`, `src/schemas/shared.schema.ts`
- `src/schemas/__tests__/*.test.ts` (4 test files)
- `src/hooks/queries/products.ts`, `src/hooks/useProducts.ts`
- `src/pages/provider/products/**` (list, create, detail/edit pages)
- `src/components/provider/products/**` (ProductList, ProductForm, ProductTypeSelector, etc.)
- `src/components/entity/Product/` (ProductEntity, ProductView, ProductForm, ProductDrawer)
- `src/components/shared/ProductTypeIcon/`, `PurchaseStatusBadge/`, `BillingPeriodIndicator/`, `UsageProgressBar/`, `PlanComparisonCard/`

**Modified files:**

- `src/types/purchase.ts`, `src/types/plans.ts`, `src/types/transaction.ts`, `src/types/account.ts`, `src/types/payment-link.ts`
- `src/router/next-paths.ts`
- `src/layout/ProviderLayout.tsx`
- `src/hooks/queries/keys.ts`, `src/hooks/queries/purchases.ts`, `src/hooks/queries/plans.ts`
- `src/components/entity/registry/index.tsx`, `src/components/entity/index.ts`
- `src/components/provider/purchases/**`, `src/components/provider/plans/**`
- `src/components/provider/transactions/**`, `src/components/provider/customers/**`
- `src/components/provider/home/**`
- `src/pages/customer/checkout/**`, `src/pages/customer/manage/**`
- `src/pages/admin/**`

**Deleted files:**

- `src/types/agent.ts`
- `src/hooks/useAgents.ts`, `src/hooks/queries/agents.ts`
- `src/hooks/__tests__/useAgents.cache.test.ts`
- `src/components/entity/Agent/**`
- `src/components/provider/agents/**`
- `src/pages/provider/agents/**`, `src/pages/provider/mcp-pay/**`
