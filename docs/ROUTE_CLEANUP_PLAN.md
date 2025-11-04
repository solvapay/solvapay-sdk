# Route Cleanup and Helper Enhancement Plan

## Overview
This document outlines patterns found across the checkout-demo and hosted-checkout-demo projects, and proposes new helpers for `@solvapay/next` to simplify route implementations.

## Architecture Decision: Generic vs Next.js-Specific

### Recommendation: **Hybrid Approach** (Best of Both Worlds)

Based on the existing SDK architecture pattern:

1. **Generic core functions** in `@solvapay/server`:
   - Take standard Web API `Request` (works everywhere)
   - Return plain data objects (no framework dependencies)
   - Handle business logic, authentication, customer sync
   - Can be used by Express, Fastify, Next.js, Edge Functions, etc.

2. **Next.js-specific wrappers** in `@solvapay/next`:
   - Take `NextRequest` (better TypeScript experience)
   - Call generic core functions
   - Return `NextResponse` (Next.js-optimized)
   - Add Next.js-specific optimizations (deduplication, caching)

### Why This Approach?

✅ **Reusability**: Generic functions can be used by Express, Fastify, Cloudflare Workers, etc.
✅ **Framework-Specific Benefits**: Next.js wrappers provide Next.js-optimized types and responses
✅ **Consistency**: Follows existing pattern (`createSolvaPay()` is generic, adapters are framework-specific)
✅ **Flexibility**: Users can use generic functions directly if they want custom behavior

### Example Structure

```typescript
// @solvapay/server (generic)
export async function syncCustomerCore(
  request: Request,
  options?: { solvaPay?: SolvaPay }
): Promise<string | ErrorResult> {
  // Generic implementation using Request (Web API standard)
  // Returns plain string or { error: string, status: number }
}

// @solvapay/next (Next.js-specific wrapper)
export async function syncCustomer(
  request: NextRequest,
  options?: { solvaPay?: SolvaPay }
): Promise<string | NextResponse> {
  // Calls syncCustomerCore, converts ErrorResult to NextResponse
  const result = await syncCustomerCore(request, options);
  if (isErrorResult(result)) {
    return NextResponse.json(result.error, { status: result.status });
  }
  return result; // string
}
```

### Alternative: Pure Next.js Helpers

**Pros:**
- Simpler implementation (no abstraction layer)
- Better Next.js integration
- Can use Next.js-specific features directly

**Cons:**
- Not reusable for Express/Fastify users
- Duplication if we later want Express helpers
- Doesn't follow existing adapter pattern

**Verdict:** Hybrid approach is better for long-term maintainability and aligns with existing architecture.

### Implementation Structure

```
@solvapay/server/
  └── src/
      └── helpers/
          ├── auth.ts          # getAuthenticatedUserCore()
          ├── customer.ts      # syncCustomerCore()
          ├── payment.ts       # createPaymentIntentCore(), processPaymentCore()
          ├── checkout.ts      # createCheckoutSessionCore(), createCustomerSessionCore()
          ├── subscription.ts  # cancelSubscriptionCore()
          └── plans.ts         # listPlansCore()

@solvapay/next/
  └── src/
      ├── index.ts            # Existing checkSubscription, cache utils
      └── helpers/
          ├── auth.ts         # getAuthenticatedUser() → wraps getAuthenticatedUserCore()
          ├── customer.ts     # syncCustomer() → wraps syncCustomerCore()
          ├── payment.ts       # createPaymentIntent() → wraps createPaymentIntentCore()
          ├── checkout.ts     # createCheckoutSession() → wraps createCheckoutSessionCore()
          ├── subscription.ts # cancelSubscription() → wraps cancelSubscriptionCore()
          └── plans.ts        # listPlans() → wraps listPlansCore()
```

### Type Definitions

```typescript
// @solvapay/server - Generic types
export interface ErrorResult {
  error: string;
  status: number;
  details?: string;
}

export interface AuthenticatedUser {
  userId: string;
  email?: string | null;
  name?: string | null;
}

// @solvapay/next - Next.js types
// Uses NextRequest/NextResponse, can add Next.js-specific optimizations
```

### Benefits of This Structure

1. **Express/Fastify users** can import from `@solvapay/server/helpers`:
   ```typescript
   import { syncCustomerCore } from '@solvapay/server/helpers';
   // Returns string | ErrorResult (framework-agnostic)
   ```

2. **Next.js users** can import from `@solvapay/next`:
   ```typescript
   import { syncCustomer } from '@solvapay/next';
   // Returns string | NextResponse (Next.js-optimized)
   ```

3. **Future Express helpers** can be added to `@solvapay/express`:
   ```typescript
   import { syncCustomer } from '@solvapay/express';
   // Returns string | Express Response
   ```

## Current State Analysis

### Routes in checkout-demo
1. `/api/list-plans` - GET
2. `/api/check-subscription` - GET
3. `/api/sync-customer` - POST
4. `/api/create-payment-intent` - POST
5. `/api/process-payment` - POST
6. `/api/cancel-subscription` - POST

### Routes in hosted-checkout-demo
1. `/api/check-subscription` - GET
2. `/api/sync-customer` - POST
3. `/api/create-checkout-session` - POST
4. `/api/create-customer-session` - POST

## Common Patterns Identified

### Pattern 1: Authentication & User Extraction
**Found in:** All authenticated routes
```typescript
const userIdOrError = requireUserId(request);
if (userIdOrError instanceof Response) {
  return userIdOrError;
}
const userId = userIdOrError;
const email = await getUserEmailFromRequest(request);
const name = await getUserNameFromRequest(request);
```

**Frequency:** 8 routes
**Opportunity:** Create `getAuthenticatedUser(request)` helper

### Pattern 2: Customer Sync
**Found in:** create-payment-intent, create-checkout-session, create-customer-session, sync-customer, process-payment
```typescript
const solvaPay = createSolvaPay();
const ensuredCustomerRef = await solvaPay.ensureCustomer(userId, userId, {
  email: email || undefined,
  name: name || undefined,
});
```

**Frequency:** 5 routes
**Opportunity:** Create `syncCustomer(request, options?)` helper

### Pattern 3: Error Handling
**Found in:** All routes
```typescript
try {
  // ... logic
} catch (error) {
  console.error('Operation failed:', error);
  
  if (error instanceof SolvaPayError) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
  
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  return NextResponse.json(
    { error: 'Operation failed', details: errorMessage },
    { status: 500 }
  );
}
```

**Frequency:** 10 routes
**Opportunity:** Create `handleRouteError(error, operationName)` helper

### Pattern 4: Cache Clearing After Operations
**Found in:** create-payment-intent, cancel-subscription, process-payment
```typescript
clearSubscriptionCache(userId);
```

**Frequency:** 3 routes
**Opportunity:** Integrate into respective helpers

### Pattern 5: List Plans (Public Route)
**Found in:** list-plans
```typescript
const { searchParams } = new URL(request.url);
const agentRef = searchParams.get('agentRef');
// Validation, create client, call listPlans
```

**Frequency:** 1 route
**Opportunity:** Create `listPlans(request)` helper

## Proposed Helpers for @solvapay/next

### 1. `getAuthenticatedUser(request: Request)`
**Purpose:** Extract authenticated user info in one call
**Returns:** `{ userId: string, email?: string, name?: string } | NextResponse`
**Usage:**
```typescript
const user = await getAuthenticatedUser(request);
if (user instanceof NextResponse) return user;
const { userId, email, name } = user;
```

### 2. `syncCustomer(request: Request, options?: { includeEmail?: boolean, includeName?: boolean })`
**Purpose:** Ensure customer exists with deduplication
**Returns:** `Promise<string | NextResponse>` (customerRef or error response)
**Usage:**
```typescript
const customerRef = await syncCustomer(request);
if (customerRef instanceof NextResponse) return customerRef;
```

### 3. `createPaymentIntent(request: Request, body: { planRef: string, agentRef: string })`
**Purpose:** Create payment intent with auth, customer sync, and cache clearing
**Returns:** `Promise<PaymentIntentResponse | NextResponse>`
**Usage:**
```typescript
const result = await createPaymentIntent(request, { planRef, agentRef });
if (result instanceof NextResponse) return result;
return NextResponse.json(result);
```

### 4. `createCheckoutSession(request: Request, body: { agentRef: string, planRef?: string })`
**Purpose:** Create checkout session with auth and customer sync
**Returns:** `Promise<{ sessionId: string, checkoutUrl: string } | NextResponse>`
**Usage:**
```typescript
const result = await createCheckoutSession(request, { agentRef, planRef });
if (result instanceof NextResponse) return result;
return NextResponse.json(result);
```

### 5. `createCustomerSession(request: Request)`
**Purpose:** Create customer session with auth and customer sync
**Returns:** `Promise<CustomerSessionResponse | NextResponse>`
**Usage:**
```typescript
const result = await createCustomerSession(request);
if (result instanceof NextResponse) return result;
return NextResponse.json(result);
```

### 6. `cancelSubscription(request: Request, body: { subscriptionRef: string, reason?: string })`
**Purpose:** Cancel subscription with auth, validation, and cache clearing
**Returns:** `Promise<SubscriptionResponse | NextResponse>`
**Usage:**
```typescript
const result = await cancelSubscription(request, { subscriptionRef, reason });
if (result instanceof NextResponse) return result;
return NextResponse.json(result);
```

### 7. `listPlans(request: Request)`
**Purpose:** List plans for an agent (public route, no auth required)
**Returns:** `Promise<{ plans: Plan[], agentRef: string } | NextResponse>`
**Usage:**
```typescript
const result = await listPlans(request);
if (result instanceof NextResponse) return result;
return NextResponse.json(result);
```

### 8. `processPayment(request: Request, body: { paymentIntentId: string, agentRef: string, planRef?: string })`
**Purpose:** Process payment with auth, customer sync, and cache clearing
**Returns:** `Promise<ProcessPaymentResult | NextResponse>`
**Usage:**
```typescript
const result = await processPayment(request, { paymentIntentId, agentRef, planRef });
if (result instanceof NextResponse) return result;
return NextResponse.json(result);
```

### 9. `handleRouteError(error: unknown, operationName: string, defaultMessage?: string)`
**Purpose:** Standardized error handling
**Returns:** `NextResponse`
**Usage:**
```typescript
try {
  // ... logic
} catch (error) {
  return handleRouteError(error, 'Create payment intent', 'Payment intent creation failed');
}
```

## Route Simplification Opportunities

### High Priority (Large Duplication)

#### 1. check-subscription
**Current:** 3 nearly identical files
**After:** Can be simplified to 1-2 lines using helper
```typescript
// Current (46 lines)
export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id'); // ❌ Unnecessary
  const result = await checkSubscription(request);
  if (result instanceof NextResponse) return result;
  return NextResponse.json(result as SubscriptionCheckResult);
}

// Proposed (using existing helper)
export async function GET(request: NextRequest) {
  const result = await checkSubscription(request);
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

#### 2. sync-customer
**Current:** checkout-demo has manual deduplication (131 lines), hosted-checkout-demo is simpler (72 lines)
**After:** Use SDK helper (should be ~10 lines)
```typescript
// Current checkout-demo (has unnecessary manual deduplication)
const inFlightRequests = new Map<string, Promise<string>>();
// ... 47 lines of deduplication logic

// Proposed (using new helper)
export async function POST(request: NextRequest) {
  const customerRef = await syncCustomer(request);
  if (customerRef instanceof NextResponse) return customerRef;
  return NextResponse.json({ customerRef, success: true });
}
```

#### 3. create-payment-intent
**Current:** 117 lines with repeated patterns
**After:** ~15 lines using helper
```typescript
// Proposed
export async function POST(request: NextRequest) {
  const { planRef, agentRef } = await request.json();
  if (!planRef || !agentRef) {
    return NextResponse.json(
      { error: 'Missing required parameters: planRef and agentRef are required' },
      { status: 400 }
    );
  }
  
  const result = await createPaymentIntent(request, { planRef, agentRef });
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

#### 4. create-checkout-session
**Current:** 95 lines with repeated patterns
**After:** ~10 lines using helper
```typescript
// Proposed
export async function POST(request: NextRequest) {
  const { planRef, agentRef } = await request.json();
  if (!agentRef) {
    return NextResponse.json(
      { error: 'Missing required parameter: agentRef is required' },
      { status: 400 }
    );
  }
  
  const result = await createCheckoutSession(request, { agentRef, planRef });
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

#### 5. create-customer-session
**Current:** 77 lines with repeated patterns
**After:** ~5 lines using helper
```typescript
// Proposed
export async function POST(request: NextRequest) {
  const result = await createCustomerSession(request);
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

### Medium Priority (Moderate Duplication)

#### 6. cancel-subscription
**Current:** 131 lines with complex validation
**After:** ~15 lines using helper (helper handles validation)
```typescript
// Proposed
export async function POST(request: NextRequest) {
  const { subscriptionRef, reason } = await request.json();
  if (!subscriptionRef) {
    return NextResponse.json(
      { error: 'Missing required parameter: subscriptionRef is required' },
      { status: 400 }
    );
  }
  
  const result = await cancelSubscription(request, { subscriptionRef, reason });
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

#### 7. process-payment
**Current:** 57 lines
**After:** ~15 lines using helper
```typescript
// Proposed
export async function POST(request: NextRequest) {
  const { paymentIntentId, agentRef, planRef } = await request.json();
  if (!paymentIntentId || !agentRef) {
    return NextResponse.json(
      { error: 'paymentIntentId and agentRef are required' },
      { status: 400 }
    );
  }
  
  const result = await processPayment(request, { paymentIntentId, agentRef, planRef });
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

#### 8. list-plans
**Current:** 88 lines
**After:** ~10 lines using helper
```typescript
// Proposed
export async function GET(request: NextRequest) {
  const result = await listPlans(request);
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
```

## Implementation Priority

### Phase 1: High-Impact Helpers (Immediate)
1. ✅ `getAuthenticatedUser` - Used by all other helpers
2. ✅ `syncCustomer` - Used by payment/checkout helpers
3. ✅ `handleRouteError` - Used by all helpers

### Phase 2: Payment Flow Helpers (High Priority)
4. ✅ `createPaymentIntent` - checkout-demo
5. ✅ `createCheckoutSession` - hosted-checkout-demo
6. ✅ `createCustomerSession` - hosted-checkout-demo
7. ✅ `processPayment` - checkout-demo

### Phase 3: Subscription Management (Medium Priority)
8. ✅ `cancelSubscription` - checkout-demo
9. ✅ `listPlans` - checkout-demo (public route)

### Phase 4: Route Simplification
10. Update all example routes to use new helpers
11. Remove manual deduplication from checkout-demo sync-customer
12. Remove unnecessary userId check from checkout-demo check-subscription

## Expected Impact

### Code Reduction
- **Before:** ~850 lines of route code across both demos
- **After:** ~200 lines of route code (75% reduction)
- **Helper code:** ~400 lines (reusable across all projects)

### Benefits
1. **Consistency:** All routes use same patterns
2. **Maintainability:** Bug fixes in one place
3. **Testing:** Helpers can be unit tested
4. **Developer Experience:** Much simpler to implement routes
5. **Documentation:** Helper docs serve as usage examples

## Migration Strategy

1. **Add helpers to `@solvapay/next`** (backwards compatible)
2. **Update one route at a time** in examples
3. **Test each route** after migration
4. **Remove old code** once all routes migrated
5. **Update documentation** with new patterns

## Notes

- All helpers should handle errors gracefully and return `NextResponse` for errors
- Helpers should be typed with proper TypeScript types
- Helpers should respect existing deduplication (don't add new deduplication where SDK already handles it)
- Public routes (like list-plans) should not require authentication
- Cache clearing should be automatic in helpers that modify subscription state

