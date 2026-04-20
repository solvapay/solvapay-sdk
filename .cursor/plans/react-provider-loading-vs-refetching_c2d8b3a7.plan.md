---
name: SolvaPayProvider loading vs isRefetching semantics
overview: The provider's `fetchPurchase` decides `setLoading` vs `setIsRefetching` based on "do purchases currently exist?". That branch misfires for consumers polling an empty-state user (e.g. Upgrade flow) — every refetch flips `loading` true for the duration of the round-trip, causing view-level remounts. Switch the decision to "has this cacheKey ever completed a fetch?" so polling behaves correctly regardless of whether the user has paid yet. Spotted while building `examples/mcp-checkout-app`; fix works for every consumer.
todos:
  - id: locate
    content: Confirm the exact branch in `packages/react/src/SolvaPayProvider.tsx` (around lines 501-506) and trace consumers that currently rely on `loading` flipping true on empty refetches
    status: pending
  - id: introduce-hasloadedonce
    content: Add a `loadedCacheKeysRef: Set<string>` (or equivalent map) to the provider; mark the cacheKey on the `finally` block of a successful fetch
    status: pending
  - id: swap-branch
    content: Replace `const hasExistingData = purchaseData.purchases.length > 0` with `const hasLoadedOnce = loadedCacheKeysRef.current.has(cacheKey)`; use that to choose `setIsRefetching(true)` vs `setLoading(true)`
    status: pending
  - id: tests
    content: Add a unit test covering the empty-state-refetch path — calling `refetch()` after an initial empty fetch should flip `isRefetching`, not `loading`
    status: pending
  - id: migration
    content: Audit existing consumers (`@example/checkout-demo`, `@example/hosted-checkout-demo`, `@example/tailwind-checkout`, docs snippets) for places that treat `loading` as the sole refetch signal; update any that should now watch `isRefetching` instead
    status: pending
  - id: mcp-example-simplify
    content: Once the fix lands, remove the local `hasLoadedOnce` gate in `examples/mcp-checkout-app/src/mcp-app.tsx` — it becomes redundant
    status: pending
isProject: false
---

## Context

Discovered during [mcp-checkout-app_polling-no-jank_a1f4e882.plan.md](solvapay-sdk/.cursor/plans/mcp-checkout-app_polling-no-jank_a1f4e882.plan.md). That plan fixes the jank inside the MCP example by working around the provider's behaviour; this one addresses the root cause so every consumer benefits.

## Problem

```501:506:solvapay-sdk/packages/react/src/SolvaPayProvider.tsx
      const hasExistingData = purchaseData.purchases.length > 0
      if (hasExistingData) {
        setIsRefetching(true)
      } else {
        setLoading(true)
      }
```

The two flags have distinct intended semantics:

- `loading`: "we don't have data to show yet — render skeleton / loader"
- `isRefetching`: "we already have data rendered — this is a background update"

The current branch conflates "do we have data yet?" with "is this the first fetch?". For a user who genuinely doesn't have purchases, those two questions diverge after the first completed fetch: we *have* loaded (we just got back an empty list), we *are* about to refetch, but `purchases.length === 0` still makes the provider report it as a first-load.

## Fix

Track first-completion per cacheKey:

```ts
const loadedCacheKeysRef = useRef(new Set<string>())

const fetchPurchase = useCallback(
  async (force = false) => {
    // …existing guards…

    const cacheKey = internalCustomerRef || userId || 'anonymous'
    // …existing in-flight check…

    const hasLoadedOnce = loadedCacheKeysRef.current.has(cacheKey)
    if (hasLoadedOnce) {
      setIsRefetching(true)
    } else {
      setLoading(true)
    }

    try {
      // …existing fetch…
    } finally {
      if (inFlightRef.current === cacheKey) {
        loadedCacheKeysRef.current.add(cacheKey)
        setLoading(false)
        setIsRefetching(false)
        inFlightRef.current = null
      }
    }
  },
  // …deps, dropping purchaseData.purchases.length…
)
```

Drop `purchaseData.purchases.length` from the `useCallback` deps. The new branch doesn't read from state (it reads from a ref), so `fetchPurchase` stops re-creating on every refetch — a small additional win for downstream effects that depend on its identity.

On sign-out / userId change, clear the ref: `loadedCacheKeysRef.current.delete(previousCacheKey)` in the existing auth-change path so a subsequent sign-in re-enters the first-load state correctly.

## Why this is safe for existing consumers

`loading` is strictly less aggressive after this change — it stays false across background refetches even when the list is empty. Consumers that previously watched `loading` for a "data is stale" signal would miss those refetches, but that was already unreliable (a refetch on a user who *did* have purchases already reported via `isRefetching`, not `loading`). The correct signal has always been `isRefetching`; this just makes it consistent.

No change to the initial-load contract: the very first fetch for a cacheKey still sets `loading: true` → `loading: false` exactly once.

## Testing

- Unit: mount provider, stub `checkPurchase` to return `{ purchases: [] }`, wait for first fetch to complete, call `refetch()`, assert `loading === false` and `isRefetching === true` during the second fetch.
- Unit: same but `checkPurchase` returns a non-empty list; assert the same invariant (regression check).
- Unit: sign-out then sign-in flow; assert the post-sign-in first fetch still sets `loading: true` (cache-key reset is working).

## Non-goals

- Introducing per-query granularity (one "hasLoadedOnce" per cacheKey is enough).
- Changing `usePurchase`'s public return shape.
- Adding a new `hasLoadedOnce` prop to the public surface. Keep it internal — consumers who want that today can derive it from `loading === false && (purchases.length > 0 || !isInitialMount)`.
