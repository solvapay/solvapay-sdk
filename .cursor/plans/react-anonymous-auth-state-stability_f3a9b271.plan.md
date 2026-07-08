---
name: react-anonymous-auth-state-stability
overview: Stop `SolvaPayProvider` from treating `getToken() === null` as a logout when `getUserId()` returns a stable identifier. Anonymous-but-identified flows (e.g. browser-bound `anon_<uuid>` customers, the chat-checkout-demo pattern) currently lose their cached `cus_*` ref and have their balance state nulled every 30s when the auth-detect poll fires, causing visible UI snap-back. Treat `userId` as an independent identity dimension; only wipe state when neither token nor userId is present.
todos:
  - id: repro-test
    content: Add a failing unit test in packages/react/src/__tests__/SolvaPayProvider-balance.test.tsx that simulates an anonymous adapter (token=null, userId=stable), seeds balance via fetch, advances 30s of fake timers, asserts credits and internalCustomerRef remain populated
    status: pending
  - id: detect-auth-fix
    content: Rewrite the cachedRef/token branch in detectAuth (SolvaPayProvider.tsx ~L261-270) to wipe state only when both userId and token are absent; preserve cached ref whenever userId is stable
    status: pending
  - id: isAuthenticated-semantics
    content: Decide whether `isAuthenticated` stays token-derived or becomes (token ?? userId !== null); document the choice in the type doc and fix any consumers that conflate the two (search for `isAuthenticated` in src/, look at fetchBalanceImpl + fetchPurchase guards)
    status: pending
  - id: fetch-guard-audit
    content: Audit `if (!isAuthenticated && !internalCustomerRef)` guards in fetchBalanceImpl + fetchPurchase + the post-customer-ref effect; ensure they still behave correctly under the new branch logic and that explicit logout (token cleared AND userId cleared) still resets state
    status: pending
  - id: subscribe-trigger
    content: Verify that adapter.subscribe()-based re-detect still produces correct transitions on real login/logout (token going from null->value->null with userId following the same pattern) and that the existing test in SolvaPayProvider-auth.test.tsx (or equivalent) passes
    status: pending
  - id: hydration-path
    content: Confirm MCP hydration path (`configRef.current?.initial`) is unaffected -- it short-circuits detectAuth so anon-related changes shouldn't reach it; add a smoke assertion if no test covers this
    status: pending
  - id: docs-anon-pattern
    content: Add a short "Anonymous customers" note to the SDK README / setup docs explaining that returning a stable userId from getUserId is sufficient (no synthetic-token workaround needed once this fix lands)
    status: pending
  - id: revert-demo-workaround
    content: After the SDK change ships, revert the synthetic-token workaround in examples/chat-checkout-demo/src/lib/anonymousCustomer.ts so getToken returns null again (the documented anonymous pattern); rerun the chat-checkout-demo end-to-end and confirm the badge stays stable across multiple 30s polls
    status: pending
  - id: changeset
    content: Add a patch-level changeset for @solvapay/react describing the fix as a non-breaking bugfix; flag the (unlikely) edge case where a consumer was relying on token=null wiping cached refs
    status: pending
isProject: false
---

# Stabilise anonymous-but-identified sessions in `SolvaPayProvider`

## Background

Some integrators identify users by a stable browser-bound reference (e.g. `anon_<uuid>` in `localStorage`) rather than a server-issued auth token. The chat-checkout-demo `createAnonymousAuthAdapter` is a representative example:

```examples/chat-checkout-demo/src/lib/anonymousCustomer.ts
export function createAnonymousAuthAdapter(customerRef: string): AuthAdapter {
  return {
    async getToken() { return null },
    async getUserId() { return customerRef },
  }
}
```

This pattern is supported in spirit -- `SolvaPayProvider` accepts both `getToken` and `getUserId`, and the cached customer-ref system is keyed on `userId` -- but the auth-detect poll currently treats `!token` as a hard logout and wipes state, even when `userId` is stable across polls.

## Root cause

`packages/react/src/SolvaPayProvider.tsx`, `detectAuth` (currently around L242-271):

```ts
const token = await adapter.getToken()
const detectedUserId = await adapter.getUserId()

setIsAuthenticated(!!token)
setUserId(detectedUserId)

// ... user-id change branch ...

const cachedRef = getCachedCustomerRef(detectedUserId)
if (cachedRef && token) {
  setInternalCustomerRef(cachedRef)
} else if (!token) {
  clearCachedCustomerRef()
  setInternalCustomerRef(undefined)
  loadedCacheKeysRef.current.clear()
} else if (token && !cachedRef) {
  setInternalCustomerRef(undefined)
}
```

The `else if (!token)` branch fires on every poll when an anonymous adapter is used, clearing both the persisted cache and the in-memory `internalCustomerRef`. That triggers the `[isAuthenticated, internalCustomerRef]`-keyed effect for `fetchBalanceImpl`, which then enters its `!isAuthenticated && !internalCustomerRef` early-return and explicitly sets credits/displayCurrency/rates back to `null`:

```packages/react/src/SolvaPayProvider.tsx
if (!isAuthenticated && !internalCustomerRef) {
  setCreditsValue(null)
  setDisplayCurrencyValue(null)
  setCreditsPerMinorUnitValue(null)
  setDisplayExchangeRateValue(null)
  setBalanceLoading(false)
  balanceLoadedRef.current = false
  return
}
```

For an anonymous user the balance pill therefore visibly snaps back to its empty state every 30s (the `setInterval(detectAuth, 30000)` cadence at L283), until the next manual refetch path (e.g. `useBalance().refetch()` or another fetch hook) rehydrates it.

## User-visible symptom

Reproducible in the chat-checkout-demo top-up scenario:

1. Reset identity in the demo header.
2. Top up credits (any pack).
3. Watch the `N MSGS LEFT` pill; observe it tick correctly down with each chat send for ~30s, then snap to `0 MSGS LEFT`, then re-stabilise on the next chat send, then snap to 0 again 30s later.

The chat-checkout-demo currently works around this by returning the `customerRef` itself from `getToken()` so the SDK never sees a `!token`. That's a hack -- the documented "anonymous" pattern shouldn't require a synthetic token.

## Proposed change

Treat `userId` as a first-class identity dimension. The provider already stores it (`userId` state, L108) and the cache key already uses it (`getCachedCustomerRef(detectedUserId)`). The fix is purely in `detectAuth`'s post-detection branch: only wipe state when both auth signals are absent.

```ts
const cachedRef = getCachedCustomerRef(detectedUserId)

if (!token && !detectedUserId) {
  // Genuinely no identity -- treat as logged out
  clearCachedCustomerRef()
  setInternalCustomerRef(undefined)
  loadedCacheKeysRef.current.clear()
} else if (cachedRef) {
  // Identity present (token, stable userId, or both) and we have a
  // cached cus_* for it -- restore and keep it bound
  setInternalCustomerRef(cachedRef)
} else {
  // Identity but no cached ref yet -- let downstream code create one
  // (ensureCustomer on first authed fetch / explicit updateCustomerRef call)
  setInternalCustomerRef(undefined)
}
```

This preserves the three existing behaviours:

- **Token-authenticated user with cached ref** → restore cached ref (was: branch 1; still: middle branch)
- **Token-authenticated user without cached ref** → clear in-memory ref, downstream creates one (was: branch 3; still: last branch)
- **Token cleared AND userId cleared (real logout)** → wipe everything (was: branch 2; still: first branch)

And adds the missing one:

- **No token but stable userId (anonymous-but-identified)** → restore cached ref keyed on userId, never wipe (was: erroneously branch 2; now: middle branch)

## `isAuthenticated` semantics

Open question: should `isAuthenticated` stay derived from `!!token` (current behaviour, narrow) or shift to `!!token || !!userId` (broad, matches the new "identity present" criterion)?

- Narrow keeps the public concept stable -- consumers reading `useSolvaPay().isAuthenticated` to gate "Sign in" UI continue to work.
- Broad simplifies the internal fetch guards (`!isAuthenticated && !internalCustomerRef` becomes redundant with `!isAuthenticated`).

Recommend: **keep narrow**. Keep `isAuthenticated` token-derived, document explicitly. The `internalCustomerRef`-presence is the identity gate inside the provider; that's already what the existing `||` checks at L289, L495, etc. do. No public API change, no consumer migration.

## Consumers of `isAuthenticated` to audit

Inside the provider:

- `fetchBalanceImpl`'s early-return guard (L147)
- `fetchPurchase`'s early-return guard (L289)
- The customer-ref-tied effect at L495

All three already use the `... && !internalCustomerRef` form, so a stable `internalCustomerRef` for anonymous flows naturally flips them to the "fetch" branch. Once `detectAuth` stops nulling `internalCustomerRef`, no further changes are needed.

External (consumers): `isAuthenticated` is exposed via `useSolvaPay()` and used in UI primitives (e.g. `LaunchCustomerPortalButton`). Those should still gate on token-presence (anonymous users shouldn't see "Manage account" CTAs that require a real session). No semantic change needed there.

## Backward compatibility

The change is non-breaking:

- Token-authenticated flows: identical observable behaviour. `isAuthenticated` still `!!token`; cached refs still bound to userId.
- MCP-hydrated flows: short-circuit at `configRef.current?.initial` (L237) is unchanged.
- Anonymous flows that previously got null'd every 30s: now stable. The `clearCachedCustomerRef` call inside the wipe branch is the only place where userId could "leak" away on a truthy-userId path, and we're fixing that exact path.
- Edge case: a consumer who explicitly relied on `getToken()` returning `null` to invalidate cached refs (i.e. logout-by-token-only) will see refs persist. This is a behaviour change but the documented logout pattern is to clear the userId too -- worth a one-line note in the changeset.

## Test plan

Add a focused unit test alongside `SolvaPayProvider-balance.test.tsx`:

```ts
it('preserves cached ref + balance when token is null but userId is stable across polls', async () => {
  vi.useFakeTimers()
  const adapter = {
    getToken: vi.fn(async () => null),
    getUserId: vi.fn(async () => 'anon_stable'),
  }
  // mount provider, seed cache via initial customerRef + balance, render useBalance
  // advance vi.advanceTimersByTime(30_000) once, assert credits === seeded value
  // advance again, assert still === seeded value
  // assert getToken called twice (poll fired) but setCreditsValue(null) never called
})
```

Plus regression coverage:

- Logout: token transitions from value → null with userId also clearing → state wiped (existing test, should still pass)
- Token-authenticated → unchanged behaviour (existing tests in SolvaPayProvider-auth.test.tsx)
- userId change with no token: trigger the existing "userId changed" branch (L254-259) and confirm cached ref is dropped as before

## Cleanup in chat-checkout-demo

Once `@solvapay/react` ships the fix and the example consumes it:

```examples/chat-checkout-demo/src/lib/anonymousCustomer.ts
export function createAnonymousAuthAdapter(customerRef: string): AuthAdapter {
  return {
    async getToken() {
      return null   // ← restore the documented anonymous pattern
    },
    async getUserId() {
      return customerRef
    },
  }
}
```

…and remove the explanatory comment block describing the workaround. Re-test the top-up flow end-to-end: badge mounts with correct count, decrements per chat send, stays stable across multiple 30s windows.

## Out of scope

- A separate `useBalance` polling/heartbeat (independent ergonomic gap; if balances should track server-side debits without a chat retry, that's a different RFC).
- Renaming `isAuthenticated` to `isIdentified` or splitting into two booleans (consumer-facing API change; defer until there's pressure).
- Cookie-based session auth (`adapter.getToken()` returning a tag while the real cookie lives in HttpOnly storage) -- already supported and unaffected.
