---
name: SolvaPayProvider loading vs isRefetching semantics
overview: The provider's `fetchPurchase` decides `setLoading` vs `setIsRefetching` based on "do purchases currently exist?". That branch misfires for consumers polling an empty-state user (e.g. Upgrade flow) — every refetch flips `loading` true for the duration of the round-trip, causing view-level remounts. Switch the decision to "has this cacheKey ever completed a fetch?" so polling behaves correctly regardless of whether the user has paid yet. Blocked on the MCP-apps / transport refactor in [`mcp-checkout-app_poc_55ffe77e.plan.md`](solvapay-sdk/.cursor/plans/mcp-checkout-app_poc_55ffe77e.plan.md) §2 — the data-fetch layer is moving behind a `transport` abstraction, and this fix should land in whatever owns `fetchPurchase` after that split.
todos:
  - id: wait-on-refactor
    content: "**Dependency**: do not start until [mcp-checkout-app_poc_55ffe77e.plan.md](solvapay-sdk/.cursor/plans/mcp-checkout-app_poc_55ffe77e.plan.md) §2 (Reusable React adapter / `transport` prop) is merged. The location of `fetchPurchase` (provider vs transport vs shared hook) changes under that refactor — applying this fix beforehand creates merge conflicts and likely re-work"
    status: pending
  - id: locate
    content: "After the refactor, confirm where `fetchPurchase` lives (e.g. `@solvapay/react` provider, shared `transport.fetchPurchase`, or a new `useRemotePurchase` hook) and relocate this fix into that module"
    status: pending
  - id: introduce-hasloadedonce
    content: Add a `loadedCacheKeysRef: Set<string>` (or equivalent map) to the post-refactor fetch owner; mark the cacheKey on the `finally` block of a successful fetch
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

## Dependency — wait on the MCP-apps / transport refactor

This fix is **blocked** on [`mcp-checkout-app_poc_55ffe77e.plan.md`](solvapay-sdk/.cursor/plans/mcp-checkout-app_poc_55ffe77e.plan.md) §2 ("Reusable React adapter"):

> Extract the ad-hoc `mcpAdapter` into `@solvapay/react/mcp` (or a new `@solvapay/mcp-app` package) exporting `createMcpAppAdapter(app)` that returns the full set of `SolvaPayProvider` overrides. … May need to extend `SolvaPayProviderProps` with overrides for hooks that currently only go via `fetch` (`useBalance`, `useProduct`, `useMerchant`, cancel/reactivate/activate). Either broaden the override surface or introduce a single `transport` prop.

That refactor directly reshapes the module this fix edits:

- If the outcome is a single `transport` prop, `fetchPurchase`'s state machine moves behind that abstraction; the loading / isRefetching flags may live in a shared hook (`useRemotePurchase`, `useRemoteBalance`, …) rather than inline in `SolvaPayProvider`.
- If the outcome is a broader overrides surface instead, the provider stays the fetch owner but grows new paths (balance, merchant, product) that should share the same "has this cacheKey ever completed a fetch?" semantics — applying the fix to `fetchPurchase` alone would be a near-term regression risk.

Landing this plan before the refactor means doing the work twice (first at the current call site, then re-plumbing it through the transport). Wait for that decision, then re-scope this plan's remaining todos around the new file layout.

## Context

Discovered during [mcp-checkout-app_polling-no-jank_a1f4e882.plan.md](solvapay-sdk/.cursor/plans/mcp-checkout-app_polling-no-jank_a1f4e882.plan.md). That plan fixes the jank inside the MCP example by working around the provider's behaviour with a local `hasLoadedOnce` gate; this plan addresses the root cause so every consumer benefits.

Under that local workaround, the MCP example already renders correctly; there's no user-facing urgency to land the SDK fix before the refactor. Treat this plan as the "one-commit cleanup" that closes out the jank story once the refactor gives it a stable home.

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
