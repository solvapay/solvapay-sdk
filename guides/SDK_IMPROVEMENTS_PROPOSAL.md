# SolvaPay SDK Improvements Proposal

## Executive Summary

This document outlines proposed improvements to the SolvaPay SDK to make it easier to implement, more performant, and more robust. The proposals focus on:

0. **Simplify SolvaPayProvider API**: Zero-config provider with configuration standard
1. **Customer Reference Storage Strategy**: How to efficiently store and retrieve the SolvaPay `customerRef` mapping
2. **Hook Architecture & Naming**: Simplifying the React hook API for better developer experience
3. **Caching Strategy**: Optimizing performance across server and client with mobile considerations

## Current State Analysis

### Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React)                                           │
│  - SolvaPayProvider uses config defaults or custom config   │
│  - Auto-detects auth token (Supabase/localStorage)         │
│  - useSubscription() fetches subscription data             │
│  - useSubscriptionHelpers(plans) provides computed values   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  API Route (/api/check-subscription)                       │
│  - Extracts userId from x-user-id header (middleware)      │
│  - Checks cached customerRef or uses externalRef lookup    │
│  - Calls ensureCustomer(userId, userId) if needed           │
│  - First param: cache key                                   │
│  - Second param: externalRef (stored on SolvaPay backend)   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  SolvaPay SDK (ensureCustomer)                             │
│  - Looks up customer by externalRef                        │
│  - Creates customer if not found                           │
│  - Returns backend customerRef (different from userId)      │
│  - Caches mapping in-memory (per-instance, lost on restart)│
└─────────────────────────────────────────────────────────────┘
```

### Current Issues

1. **Mapping Loss on Restart**: In-memory cache is lost when server restarts, requiring re-lookup
2. **Hook Separation**: Two hooks (`useSubscription` + `useSubscriptionHelpers`) require additional boilerplate
3. **Confusing Naming**: The distinction between Supabase `userId` and SolvaPay `customerRef` is unclear
4. **No Client Persistence**: Frontend doesn't cache the backend `customerRef` for faster subsequent loads
5. **Confusing customerRef Prop**: Passing Supabase `userId` as `customerRef` prop is misleading - it's not the actual SolvaPay customerRef
6. **Excessive Boilerplate**: Every implementation requires manual auth state tracking and passing userId to provider

## Constraints & Requirements

### Target Audience
- **Primary**: Indie builders starting from scratch with Supabase
- **Secondary**: Developers using various auth stacks (Supabase Auth, NextAuth, Auth0, Firebase Auth)
- **Note**: Some builders have users tables, but many only use auth services

### Requirements
- ✅ **Minimal Code**: As little code as possible for setup
- ✅ **Performant**: Fast lookups, minimal API calls
- ✅ **Robust**: Works reliably across server restarts and deployments
- ✅ **Mobile-Friendly**: Works well on mobile devices
- ✅ **Simple API**: Easy to understand and use

## Proposal 0: Simplify SolvaPayProvider API (Zero-Config Provider)

### Problem Statement

Currently, `SolvaPayProvider` requires passing `customerRef` (which is confusingly the Supabase `userId`, not the actual SolvaPay `customerRef`), and the `checkSubscription` callback receives a parameter that it ignores (since the API route uses middleware instead).

**Current Issues:**
1. **Confusing API**: Passing Supabase `userId` as `customerRef` prop is misleading
2. **Unused Parameter**: `checkSubscription(customerRef)` parameter is ignored - API uses middleware
3. **Boilerplate**: Every implementation manually tracks auth state and passes it to provider
4. **Inconsistent**: `createPayment` also ignores `customerRef` parameter - API routes use middleware

**Current Implementation (confusing):**
```typescript
const [customerId, setCustomerId] = useState<string>('');

useEffect(() => {
  const userId = await getUserId();
  setCustomerId(userId); // Supabase userId
}, []);

<SolvaPayProvider
  customerRef={customerId}  // Actually Supabase userId, not customerRef!
  checkSubscription={async (customerRef) => {
    // customerRef parameter is ignored!
    const res = await fetch('/api/check-subscription', { headers });
    return res.json();
  }}
  createPayment={async ({ planRef, customerRef }) => {
    // customerRef parameter is also ignored!
    const res = await fetch('/api/create-payment-intent', {
      body: JSON.stringify({ planRef }) // customerRef not used
    });
    return res.json();
  }}
>
```

### Proposed Solution: Configuration Standard with Defaults

Make `SolvaPayProvider` work with sensible defaults that minimize code, while allowing full customization when needed. The provider should automatically:
1. Detect authentication state (via token in headers)
2. Use standard API routes by default
3. Fetch subscriptions when mounted (if authenticated)
4. Store `customerRef` internally from API responses
5. Refetch when auth state changes

**New Implementation (simplified):**
```typescript
// Minimal (zero config)
<SolvaPayProvider>
  {children}
</SolvaPayProvider>

// Custom API routes
<SolvaPayProvider
  config={{
    api: {
      checkSubscription: '/custom/api/subscription',
      createPayment: '/custom/api/payment'
    }
  }}
>
  {children}
</SolvaPayProvider>

// Custom auth
<SolvaPayProvider
  config={{
    auth: {
      getToken: async () => await myAuthService.getToken()
    }
  }}
>
  {children}
</SolvaPayProvider>
```

### Configuration Standard

The provider uses a configuration object pattern with sensible defaults:

**Default Assumptions:**
- API routes: `/api/check-subscription`, `/api/create-payment-intent`, `/api/process-payment`
- Auth detection: Tries Supabase client first, then localStorage
- Fetch: Uses global `fetch` API
- Headers: Standard `Authorization: Bearer <token>` header

**Customization Options:**
- Override API routes via `config.api`
- Override auth via `config.auth.getToken`
- Override fetch via `config.fetch`
- Add custom headers via `config.headers`
- Fully override functions via props (for complex cases)

**Implementation Priority:**
1. Custom functions (props) - highest priority
2. Config overrides - medium priority  
3. Defaults - lowest priority

```typescript
/**
 * SolvaPay Provider Configuration
 * Sensible defaults for minimal code, but fully customizable
 */
interface SolvaPayConfig {
  /**
   * API route configuration
   * Defaults to standard Next.js API routes
   */
  api?: {
    checkSubscription?: string;  // Default: '/api/check-subscription'
    createPayment?: string;       // Default: '/api/create-payment-intent'
    processPayment?: string;      // Default: '/api/process-payment'
  };
  
  /**
   * Authentication configuration
   * Provider will auto-detect from common sources
   */
  auth?: {
    /**
     * Function to get auth token
     * Default: tries to detect from Supabase client, then localStorage
     */
    getToken?: () => Promise<string | null>;
    
    /**
     * Function to get user ID (for cache key)
     * Default: extracts from token or uses anonymous
     */
    getUserId?: () => Promise<string | null>;
  };
  
  /**
   * Custom fetch implementation
   * Default: uses global fetch
   */
  fetch?: typeof fetch;
  
  /**
   * Request headers to include in all API calls
   * Default: empty
   */
  headers?: HeadersInit | (() => Promise<HeadersInit>);
  
  /**
   * Custom error handler
   * Default: logs to console
   */
  onError?: (error: Error, context: string) => void;
}

interface SolvaPayProviderProps {
  /**
   * Configuration object with sensible defaults
   * If not provided, uses standard Next.js API routes
   */
  config?: SolvaPayConfig;
  
  /**
   * Custom API functions (override config defaults)
   * Use only if you need custom logic beyond standard API routes
   */
  createPayment?: (params: { planRef: string }) => Promise<PaymentIntentResult>;
  checkSubscription?: () => Promise<CustomerSubscriptionData>;
  processPayment?: (params: {
    paymentIntentId: string;
    agentRef: string;
    planRef?: string;
  }) => Promise<ProcessPaymentResult>;
  
  children: React.ReactNode;
}
```

### Usage Examples

**Minimal (Zero Config):**
```typescript
// Uses defaults: /api/check-subscription, /api/create-payment-intent
// Auto-detects auth from Supabase client or localStorage
<SolvaPayProvider>
  {children}
</SolvaPayProvider>
```

**Custom API Routes:**
```typescript
<SolvaPayProvider
  config={{
    api: {
      checkSubscription: '/custom/api/subscription',
      createPayment: '/custom/api/payment'
    }
  }}
>
  {children}
</SolvaPayProvider>
```

**Custom Auth:**
```typescript
<SolvaPayProvider
  config={{
    auth: {
      getToken: async () => {
        // Custom auth token retrieval
        return await myAuthService.getToken();
      }
    }
  }}
>
  {children}
</SolvaPayProvider>
```

**Fully Custom (Override):**
```typescript
<SolvaPayProvider
  checkSubscription={async () => {
    // Fully custom implementation
    return await myCustomAPI.checkSubscription();
  }}
  createPayment={async ({ planRef }) => {
    // Fully custom implementation
    return await myCustomAPI.createPayment(planRef);
  }}
>
  {children}
</SolvaPayProvider>
```

### Key Changes

#### 1. Remove `customerRef` Prop Requirement

**Before:**
```typescript
interface SolvaPayProviderProps {
  customerRef?: string;  // Required for triggering fetches
  checkSubscription: (customerRef: string) => Promise<CustomerSubscriptionData>;
  createPayment: (params: { planRef: string; customerRef: string }) => Promise<PaymentIntentResult>;
}
```

**After:**
```typescript
interface SolvaPayProviderProps {
  config?: SolvaPayConfig;  // Optional configuration
  // customerRef removed - provider detects auth automatically
  checkSubscription?: () => Promise<CustomerSubscriptionData>;  // Parameterless!
  createPayment?: (params: { planRef: string }) => Promise<PaymentIntentResult>;  // No customerRef param
  processPayment?: (params: {
    paymentIntentId: string;
    agentRef: string;
    planRef?: string;
    // customerRef removed - comes from internal state
  }) => Promise<ProcessPaymentResult>;
}
```

#### 2. Internal State Management

The provider will:
- Store `customerRef` internally from `checkSubscription` response
- Store `userId` internally by extracting from auth token (for cache key)
- Automatically refetch subscriptions when:
  - Component mounts (if authenticated)
  - Auth token changes (detected via `checkSubscription` calls)
  - Manual `refetch()` called

#### 3. Default Implementation Logic

```typescript
// Default getToken implementation
const defaultGetToken = async (): Promise<string | null> => {
  // Try Supabase client (if available)
  if (typeof window !== 'undefined') {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    } catch {
      // Supabase not available, continue to next option
    }
    
    // Try localStorage
    const token = localStorage.getItem('auth_token');
    if (token) return token;
  }
  
  return null;
};

// Default checkSubscription implementation
const defaultCheckSubscription = async (config: SolvaPayConfig) => {
  const token = await (config.auth?.getToken || defaultGetToken)();
  const route = config.api?.checkSubscription || '/api/check-subscription';
  
  const res = await (config.fetch || fetch)(route, {
    headers: {
      'Authorization': token ? `Bearer ${token}` : '',
      ...(config.headers ? await (typeof config.headers === 'function' ? config.headers() : config.headers) : {})
    }
  });
  
  if (!res.ok) {
    const error = new Error(`Failed to check subscription: ${res.statusText}`);
    config.onError?.(error, 'checkSubscription');
    throw error;
  }
  
  return res.json();
};
```

### Benefits

1. **Simpler API**: No confusing `userId` vs `customerRef` mapping
2. **Less Boilerplate**: No manual auth state tracking needed
3. **Clearer Intent**: Provider handles user detection automatically
4. **Universal**: Works with any auth system (just pass token in headers)
5. **Fewer Bugs**: Can't accidentally pass wrong `customerRef`
6. **Progressive Enhancement**: Start with zero config, customize as needed

### Breaking Changes

**Clean API changes:**
- `checkSubscription` signature changes: `(customerRef: string) =>` → `() =>`
- `createPayment` signature changes: `({ planRef, customerRef }) =>` → `({ planRef }) =>`
- `customerRef` prop removed completely
- All old patterns removed - clean break to new API

**Migration effort:** Simple - update to new API patterns

### Files to Modify

1. **packages/react/src/types/index.ts**
   - Update `SolvaPayProviderProps` interface
   - Add `SolvaPayConfig` interface
   - Remove `customerRef` from `createPayment` params
   - Remove `customerRef` parameter from `checkSubscription`

2. **packages/react/src/SolvaPayProvider.tsx**
   - Remove `customerRef` prop handling
   - Add config handling with defaults
   - Store `customerRef` internally from API responses
   - Auto-fetch on mount
   - Use internal `customerRef` for `createPayment`
   - Implement default auth detection logic

3. **packages/react/src/hooks/useCheckout.ts**
   - Update to use internal `customerRef` from context
   - Remove `customerRef` requirement checks

4. **packages/react/src/PaymentForm.tsx**
   - Update to use internal `customerRef` from context

5. **All examples**
   - Update to new API
   - Remove manual `customerRef` state management
   - Show minimal config examples

### Estimated Effort: 6-8 hours

This change significantly simplifies the API and reduces confusion, making it easier for indie builders to get started.

## Proposal 1: Customer Reference Storage Strategy

### Current Flow

The SDK already uses `externalRef` (Supabase userId) to look up customers:

```typescript
// In ensureCustomer:
if (externalRef && this.apiClient.getCustomerByExternalRef) {
  const existingCustomer = await this.apiClient.getCustomerByExternalRef({ externalRef });
  // Returns customerRef if found
}
```

This uses the existing SolvaPay API endpoint: `GET /v1/sdk/customers?externalRef={externalRef}`

### Optimization Strategy: Enhanced Caching

Since we already have `externalRef` lookup, we can optimize by:

1. **Client-side caching**: Store `customerRef` in localStorage after first lookup
2. **Server-side caching**: Enhance existing in-memory cache with longer TTL
3. **Use externalRef lookup**: Leverage existing SolvaPay backend storage via `getCustomerByExternalRef`

### Option A: Client-Side localStorage Caching (Recommended)

**How it works:**
- After `checkSubscription` returns `customerRef`, store it in localStorage
- Include cached `customerRef` in subsequent API calls via header
- Server validates cached ref exists before using it
- Falls back to `getCustomerByExternalRef` lookup if cache invalid

**Pros:**
- ✅ Works with ANY auth stack (not Supabase-specific)
- ✅ Fast client-side lookups (no API call needed)
- ✅ Mobile-friendly (localStorage works on mobile browsers)
- ✅ Reduces server load significantly
- ✅ Uses existing SolvaPay backend storage (externalRef)
- ✅ No additional server-side storage needed

**Cons:**
- ❌ Requires localStorage API (not available in SSR)
- ❌ Cache can become stale (mitigated with expiration)
- ❌ Doesn't persist across devices (but that's fine - each device can cache independently)

**Implementation:**
```typescript
// Client-side (SolvaPayProvider)
const cachedRef = localStorage.getItem('solvapay_customerRef');
if (cachedRef) {
  // Include in API call header
  headers['x-solvapay-customer-ref'] = cachedRef;
}

// Server-side (checkSubscription)
const cachedRef = request.headers.get('x-solvapay-customer-ref');
if (cachedRef) {
  // Validate cached ref exists
  const customer = await solvaPay.getCustomer({ customerRef: cachedRef });
  if (customer) return customer; // Use cached ref - fast path!
}
// Fall back to getCustomerByExternalRef lookup (already implemented)
```

**Performance:**
- Cache hit: ~5ms (localStorage read) vs ~200ms (API call)
- Cache miss: Same as current (uses existing externalRef lookup)

**Best for:** Universal solution, works with all auth stacks

### Option B: Enhanced Server-Side Caching

**How it works:**
- Increase shared deduplicator TTL from 5 seconds to 60 seconds
- Store mapping in longer-lived cache
- Still uses `getCustomerByExternalRef` as fallback

**Pros:**
- ✅ Simple implementation (just increase TTL)
- ✅ Works server-side (no client changes needed)
- ✅ Shared across requests in same instance

**Cons:**
- ❌ Lost on server restart (still need lookup)
- ❌ Not shared across instances
- ❌ Still requires API call on first request per instance

**Implementation:**
```typescript
// Update shared deduplicator TTL
const sharedCustomerLookupDeduplicator = createRequestDeduplicator<string>({
  cacheTTL: 60000, // 60 seconds instead of 5 seconds
  maxCacheSize: 1000,
  cacheErrors: false,
});
```

**Best for:** Quick improvement without client changes

### Option C: Combined Approach (Recommended)

**How it works:**
- **Client-side**: localStorage caching (fastest path)
- **Server-side**: Enhanced TTL (60 seconds) for cache misses
- **Fallback**: Existing `getCustomerByExternalRef` lookup (already implemented)

**Pros:**
- ✅ Best performance (client cache hit: ~5ms)
- ✅ Server-side optimization (60s cache reduces API calls)
- ✅ Uses existing SolvaPay backend storage (externalRef)
- ✅ Universal (works with any auth stack)
- ✅ Mobile-friendly
- ✅ Simple implementation

**Cons:**
- ❌ Requires client-side changes (but minimal)

**Implementation Priority:**
1. Check localStorage cache (client-side)
2. If cache miss, check server cache (60s TTL)
3. If cache miss, use `getCustomerByExternalRef(userId)` (existing API)

**Performance Analysis:**
- **Client cache hit**: ~5ms (localStorage) - **95% of requests after first load**
- **Server cache hit**: ~10ms (in-memory) - **99% of requests**
- **Cache miss**: ~200ms (API call to SolvaPay) - **<1% of requests**

### Recommendation: **Option C (Combined)**

Provides optimal performance using existing `externalRef` infrastructure on the SolvaPay backend.

**No additional complexity or performance issues:**
- ✅ Uses existing SolvaPay API endpoints
- ✅ No new dependencies
- ✅ Works universally (not Supabase-specific)
- ✅ Simple client-side caching implementation
- ✅ Leverages existing backend storage

## Proposal 2: Hook Architecture & Naming

### Current State

```typescript
// Two separate hooks:
const { subscriptions, loading, hasActiveSubscription } = useSubscription();
const { hasPaidSubscription, formatDate } = useSubscriptionHelpers(plans);
```

### Option A: Keep Separate (Recommended)

**Rationale:**
- `useSubscription`: Fetches and manages subscription data (network concern)
- `useSubscriptionHelpers`: Computes derived values from subscriptions (computation concern)
- Separation of concerns: data fetching vs. data transformation
- Better performance: helpers only recalculate when subscriptions change
- Clearer mental model: "What data do I have?" vs. "What can I do with this data?"

**Improved Naming:**
```typescript
// Option 1: Keep current names but clarify purpose
useSubscription()           // Fetches subscription data
useSubscriptionHelpers()    // Computes values from subscriptions

// Option 2: Rename for clarity
useSubscription()           // Fetches subscription data
useSubscriptionQueries()    // Queries/computes from subscriptions

// Option 3: More descriptive
useSubscription()           // Fetches subscription data  
useSubscriptionStatus()     // Computes subscription status/helpers
```

**Pros:**
- ✅ Clear separation of concerns
- ✅ Better performance (independent memoization)
- ✅ Easier to understand purpose
- ✅ Optional helpers (only import if needed)

**Cons:**
- ❌ Two hooks to import
- ❌ Requires passing `plans` array

**Recommendation:** Keep separate, rename `useSubscriptionHelpers` → `useSubscriptionStatus` for clarity

### Option B: Merge Hooks

**How it works:**
- Make `plans` parameter optional in `useSubscription`
- Include helpers when `plans` provided

**Pros:**
- ✅ One hook to import
- ✅ Less boilerplate

**Cons:**
- ❌ Heavier hook (always includes helper logic)
- ❌ Requires `plans` parameter even when not needed
- ❌ Mixes concerns (fetching + computation)
- ❌ More complex internal logic

**Recommendation:** ❌ Not recommended - violates separation of concerns

### Final Recommendation: **Keep Separate, Improve Naming**

```typescript
// Clear, purpose-driven names:
const subscription = useSubscription();           // Data fetching
const status = useSubscriptionStatus(plans);      // Status computation
```

## Proposal 3: Caching Strategy

### Current Caching

**Server-side:**
- In-memory per-instance cache (lost on restart)
- Shared deduplicator with 5-second TTL
- Max 1000 entries

**Client-side:**
- No caching beyond React state

### Proposed Improvements

#### Server-Side Caching

1. **Enhanced TTL** (All users):
   - Increase shared deduplicator TTL from 5 seconds to 60 seconds
   - Uses existing `getCustomerByExternalRef` lookup as fallback
   - Cache hit rate: ~99% after first request per instance

2. **Shared Cache** (All users):
   - Keep existing in-memory cache
   - Use Redis for multi-instance deployments (optional)
   - Fallback to `getCustomerByExternalRef` for cache misses

#### Client-Side Caching

1. **localStorage** (All users):
   - Store `customerRef` with 24-hour expiration
   - Store timestamp for cache invalidation
   - Clear on sign-out

2. **React Query** (Optional):
   - Consider React Query integration for advanced caching
   - Automatic refetch on window focus
   - Stale-while-revalidate pattern

**Implementation:**
```typescript
// localStorage caching
const CUSTOMER_REF_KEY = 'solvapay_customerRef';
const CUSTOMER_REF_EXPIRY = 'solvapay_customerRef_expiry';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function getCachedCustomerRef(): string | null {
  const cached = localStorage.getItem(CUSTOMER_REF_KEY);
  const expiry = localStorage.getItem(CUSTOMER_REF_EXPIRY);
  
  if (!cached || !expiry) return null;
  
  if (Date.now() > parseInt(expiry)) {
    localStorage.removeItem(CUSTOMER_REF_KEY);
    localStorage.removeItem(CUSTOMER_REF_EXPIRY);
    return null;
  }
  
  return cached;
}

function setCachedCustomerRef(customerRef: string): void {
  localStorage.setItem(CUSTOMER_REF_KEY, customerRef);
  localStorage.setItem(CUSTOMER_REF_EXPIRY, String(Date.now() + CACHE_DURATION));
}
```

### Mobile Considerations

- ✅ localStorage works on mobile browsers
- ✅ Consider AsyncStorage for React Native (future enhancement)
- ✅ Clear cache on sign-out to prevent stale data
- ✅ Cache expiration handles device time changes

### Recommendation: **Combined Caching**

- localStorage for all users (client-side, fastest path)
- Server-side in-memory cache (60s TTL, shared deduplicator)
- Existing `getCustomerByExternalRef` API as fallback (uses SolvaPay backend storage)

## Implementation Plan

### Phase 0: Simplify SolvaPayProvider API (High Priority)

**Files to modify:**
- `packages/react/src/types/index.ts` - Add `SolvaPayConfig` interface, update `SolvaPayProviderProps`
- `packages/react/src/SolvaPayProvider.tsx` - Add config handling, remove customerRef prop requirement
- `packages/react/src/hooks/useCheckout.ts` - Update to use internal customerRef
- `packages/react/src/PaymentForm.tsx` - Update to use internal customerRef
- All examples - Update to new API

**Steps:**
1. Add `SolvaPayConfig` interface with all configuration options
2. Update `SolvaPayProviderProps` to include optional `config` prop
3. Implement default auth detection (Supabase client, localStorage)
4. Implement default API route handlers
5. Remove `customerRef` prop completely
6. Remove `customerRef` parameter from `checkSubscription` and `createPayment` signatures
7. Store `customerRef` internally from API responses
8. Update all examples to use new API

**Estimated effort:** 6-8 hours

### Phase 1: Customer Reference Storage (High Priority)

**Files to modify:**
- `packages/next/src/index.ts` - Update `checkSubscription` to check cached customerRef header
- `packages/react/src/SolvaPayProvider.tsx` - Add localStorage caching and header passing
- `packages/server/src/paywall.ts` - Increase cache TTL to 60 seconds

**Steps:**
1. Add localStorage caching in provider (store customerRef after first fetch)
2. Pass cached customerRef in API request headers
3. Update `checkSubscription` to check cached ref header first
4. Validate cached ref exists before using it
5. Fall back to existing `getCustomerByExternalRef` lookup (already implemented)
6. Increase shared deduplicator TTL to 60 seconds

**Estimated effort:** 3-4 hours (uses existing externalRef infrastructure)

### Phase 2: Hook Naming & Documentation (Medium Priority)

**Files to modify:**
- `packages/react/src/hooks/useSubscriptionHelpers.ts` - Rename to `useSubscriptionStatus`
- `packages/react/src/index.ts` - Export with new name only
- All guides and examples

**Steps:**
1. Rename hook file and function
2. Remove old export completely
3. Update all documentation
4. Update examples

**Estimated effort:** 2-3 hours

### Phase 3: Performance Optimization (Lower Priority)

**Files to modify:**
- `packages/server/src/paywall.ts` - Increase cache TTL
- Add Redis integration guide (optional)

**Steps:**
1. Increase shared deduplicator TTL to 60 seconds
2. Add Redis caching guide for multi-instance deployments

**Estimated effort:** 1-2 hours

## Migration Guide

### For Existing Users

**Clean break to new API:**
- Update imports to use new hook names
- Update provider usage to new config-based API
- Remove manual `customerRef` prop handling

**Migration examples:**
```typescript
// Old API (removed)
import { useSubscriptionHelpers } from '@solvapay/react';
<SolvaPayProvider customerRef={userId} checkSubscription={...}>

// New API (clean)
import { useSubscriptionStatus } from '@solvapay/react';
<SolvaPayProvider config={{ api: { checkSubscription: '/api/check-subscription' } }}>
```

## Success Metrics

### Performance Improvements
- ✅ Customer lookup time: < 50ms (with cache) vs. ~200ms (current)
- ✅ API calls reduced: 90% reduction after first request
- ✅ Mobile performance: Faster initial load with localStorage cache

### Developer Experience
- ✅ Reduced boilerplate: Fewer lines of code for common patterns (50-70% reduction)
- ✅ Clearer API: Better naming and documentation
- ✅ Easier onboarding: Less confusion about customerRef vs userId
- ✅ Zero-config setup: Provider works out of the box with defaults
- ✅ Simplified API: No manual auth state tracking required

## Questions & Considerations

1. **Using externalRef for customer storage**: How do we store and retrieve customer mappings?
   - **Recommendation**: Use existing `getCustomerByExternalRef` API on SolvaPay backend. This stores the mapping server-side and works universally with any auth stack.

2. **Cache Invalidation**: How to handle when customerRef changes?
   - **Recommendation**: Clear cache on sign-out, check expiry on sign-in, validate cached ref on server

3. **Multi-device**: How to handle same user on multiple devices?
   - **Recommendation**: Each device caches independently, server validates cached ref exists

4. **Security**: Is localStorage safe for customerRef?
   - **Recommendation**: Yes - customerRef is not sensitive, just an identifier

5. **Performance**: Does using externalRef lookup add latency?
   - **Recommendation**: No - client-side caching eliminates 95% of API calls. Cache misses use existing fast lookup.

## Conclusion

The proposed improvements focus on:
0. **Zero-config provider** with configuration standard for minimal code setup
1. **Client-side caching** (localStorage) + server-side caching (60s TTL) using existing `externalRef` lookup on SolvaPay backend
2. **Better naming** (`useSubscriptionStatus`) for clarity
3. **Mobile-friendly** caching strategy

These changes prioritize clean code and developer experience, especially for indie builders using Supabase. The configuration standard approach ensures that developers can start with zero configuration and progressively customize as needed, aligning perfectly with the "minimal code" requirement. Using existing `externalRef` infrastructure on the SolvaPay backend keeps the solution simple and universal, working with any auth stack.

