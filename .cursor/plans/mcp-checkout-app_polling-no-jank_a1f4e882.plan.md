---
name: mcp-checkout-app polling without jank
overview: 'The 3-second `check_purchase` poll in `examples/mcp-checkout-app` used to remount the whole card on every tick for users without an existing purchase. **Shipped** — example side landed in commit `24cc55e` (stop mcp-checkout-app remounting on every poll); provider side landed under [react-provider-loading-vs-refetching_c2d8b3a7.plan.md](solvapay-sdk/.cursor/plans/react-provider-loading-vs-refetching_c2d8b3a7.plan.md) via `loadedCacheKeysRef` in `SolvaPayProvider`. Closed for historical record.'
todos:
  - id: diagnose
    content: "Reproduce + document the jank — loading flash on poll when `purchases.length === 0`, plus React unmount/remount across the three top-level return branches in `CheckoutBody`. **Done** — root cause documented in the body below."
    status: completed
  - id: stabilize-frame
    content: "Collapse the four `return` branches in `CheckoutBody` into a single outer `<div className=\"checkout-card\">` whose inner content swaps based on derived state, so React keeps the same DOM node across polls. **Done** — see [examples/mcp-checkout-app/src/mcp-app.tsx](solvapay-sdk/examples/mcp-checkout-app/src/mcp-app.tsx) `CheckoutBody`: single outer `<div className=\"checkout-card\" data-refreshing={...}>` wraps the derived `inner` state."
    status: completed
  - id: hasloadedonce
    content: "Track `hasLoadedOnce` locally so the full-bleed \"Loading purchase…\" view only renders on the very first mount; subsequent polls never replace the card. **Done via SDK fix** — the local gate was removed after the `sdk-followup` shipped. Now `loading` from `usePurchase` only flips true on the first fetch per cacheKey; `isRefetching` covers background polls. See `mcp-app.tsx` \"Initial mount: show a dedicated loading card until the first fetch finishes.\""
    status: completed
  - id: refresh-indicator
    content: "Replace the full \"Loading\" card with a subtle inline indicator (dim opacity / tiny header spinner) during background refetches so the user still sees activity without layout shift. **Done** — `data-refreshing={isRefetching ? 'true' : undefined}` on the outer card drives a CSS opacity dip via `examples/mcp-checkout-app/src/mcp-app.css`."
    status: completed
  - id: memo-awaiting
    content: "Memoize `AwaitingCard` + extract the hosted-link subtree so polling-induced parent re-renders don't rerun anchor DOM diffs. **Done** — `AwaitingBody`, `ManageBody`, `CancelledBody`, `UpgradeBody`, and `HostedLinkButton` are all wrapped in `React.memo` in `mcp-app.tsx`. `inner` is derived via `useMemo` with primitive dep inputs."
    status: completed
  - id: verify
    content: "Confirm via `basic-host`: clicking Upgrade → awaiting card stays stable across ~5 polls; completing payment flips the card once without intermediate flash. **Done** — covered by the `smoke-run` on [react-mcp-app-adapter_e5a04f19.plan.md](solvapay-sdk/.cursor/plans/react-mcp-app-adapter_e5a04f19.plan.md); State 3 Manage polling observed cleanly with no layout shift."
    status: completed
  - id: sdk-followup
    content: "Follow-up: file an issue / open PR against `SolvaPayProvider` to switch the `setLoading` vs `setIsRefetching` branch from `purchases.length > 0` to a `hasLoadedOnce` check scoped to the current cacheKey. **Done** — shipped under [react-provider-loading-vs-refetching_c2d8b3a7.plan.md](solvapay-sdk/.cursor/plans/react-provider-loading-vs-refetching_c2d8b3a7.plan.md) via `loadedCacheKeysRef: Set<string>` in [packages/react/src/SolvaPayProvider.tsx](solvapay-sdk/packages/react/src/SolvaPayProvider.tsx), with two unit tests asserting `isRefetching: true, loading: false` mid-flight on both empty-state and non-empty refetches."
    status: completed
isProject: false
---

## What the user sees

When the user is in the default Upgrade state or the Waiting-for-payment state (i.e. no `purchases` yet), every 3-second poll makes the whole card flash to "Loading purchase…" for the duration of the MCP round-trip (~100–400 ms), then snap back. Scroll position, focus, and the spinner animation all reset on each tick.

## Root cause

Two independent contributions, both in our example (the provider's behaviour is arguably sub-optimal but not the immediate culprit):

### 1. Provider flips `loading: true` on every empty refetch

```501:506:solvapay-sdk/packages/react/src/SolvaPayProvider.tsx
      const hasExistingData = purchaseData.purchases.length > 0
      if (hasExistingData) {
        setIsRefetching(true)
      } else {
        setLoading(true)
      }
```

The decision is "do we *currently* have purchases?". For a user who doesn't (yet) have any, every refetch — even polled ones — takes the `setLoading(true)` branch. `usePurchase()` → `CheckoutBody` sees `loading === true` → the top-level `if (loading) return <Loading…/>` fires.

### 2. `CheckoutBody` has four top-level returns with different subtrees

```105:225:solvapay-sdk/examples/mcp-checkout-app/src/mcp-app.tsx
  if (loading) return <div className="checkout-card"><p>Loading purchase…</p></div>
  if (awaiting) return <AwaitingCard … />
  if (hasPaidPurchase && activePurchase) return <div className="checkout-card"> … </div>
  if (shouldShowCancelledNotice && …) return <div className="checkout-card"> … </div>
  return <div className="checkout-card"> … upgrade … </div>
```

React can't reconcile across sibling returns — each tick that flips `loading` on/off causes the Loading and Awaiting subtrees to unmount/remount, so the spinner inside `AwaitingCard` restarts its animation from 0 every 3 s.

## Fix

Three narrow changes inside `src/mcp-app.tsx`, no SDK edits.

### 1. Stabilize the card frame

Replace the multi-return structure with a single outer element and inner content that varies by derived state:

```tsx
const content = useMemo(() => {
  if (awaiting) return <AwaitingBody awaiting={awaiting} timedOut={awaitingTimedOut} … />
  if (hasPaidPurchase && activePurchase) return <ManageBody activePurchase={activePurchase} customer={customer} />
  if (shouldShowCancelledNotice && cancelledPurchase) return <CancelledBody … />
  return <UpgradeBody checkout={checkout} onLaunch={beginAwaiting} />
}, [awaiting, awaitingTimedOut, hasPaidPurchase, activePurchase, customer, checkout, …])

return (
  <div className="checkout-card" data-refreshing={isRefreshing ? 'true' : undefined}>
    {content}
  </div>
)
```

The outer `<div>` keeps stable DOM identity; React reconciles the inner subtree against the previous one instead of remounting. `AwaitingBody`'s spinner keeps animating because its `<span className="checkout-spinner">` is the same element across renders.

### 2. Gate the loading card behind `hasLoadedOnce`

```tsx
const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
useEffect(() => {
  if (!loading && !hasLoadedOnce) setHasLoadedOnce(true)
}, [loading, hasLoadedOnce])

const showInitialLoading = loading && !hasLoadedOnce
```

- On the first mount, `showInitialLoading` is `true` until the initial fetch completes, preserving the current "Loading purchase…" UX.
- On every subsequent poll, even if `loading` flips true (because the provider's refetch path still does that for empty lists), `showInitialLoading` stays `false` — the card never replaces itself.

Background-load feedback during polls is delegated to change (3) below.

### 3. Subtle refresh indicator

Instead of the full-bleed loading card, show a tiny inline signal when a refetch is in-flight post-first-load:

- `const isRefreshing = (loading || isRefetching) && hasLoadedOnce`
- Drop `opacity: 0.85` on the card via `data-refreshing="true"` for the duration of the fetch. No layout shift, no spinner flash — just a ~100 ms dim that users barely register.
- Optionally render a small inline spinner next to the card header when `isRefreshing` is true, reusing the existing `.checkout-spinner` class.

Do not remount the awaiting-state spinner based on `isRefreshing` — that's the explicit "waiting for payment" affordance and should keep its steady animation.

### 4. Memoize the awaiting subtree

`AwaitingCard` currently re-renders on every poll tick because `CheckoutBody` re-runs. Extract it into a `memo()` component (or inline the memoization around the JSX it emits) keyed on `awaiting.href + timedOut`. Nothing else inside the card depends on the polled purchase data. Same treatment for `UpgradeBody` — the only prop that should change is `checkout.status` / `checkout.href`.

## Non-goals

- Changing the poll cadence (3 s is fine once the view stops remounting).
- Moving polling into `@solvapay/react` itself. The example demonstrates the per-app pattern; consolidating into the SDK is a separate design question.
- Replacing `usePurchase` with a custom hook in the example.

## SDK follow-up (separate PR, not blocking)

File an issue against `@solvapay/react`: switch the `setLoading` vs `setIsRefetching` decision in `fetchPurchase` ([SolvaPayProvider.tsx:501-506](solvapay-sdk/packages/react/src/SolvaPayProvider.tsx)) from "do we have existing data?" to "has this cacheKey ever completed a fetch?". A provider-level `hasLoadedOnceRef: Record<cacheKey, boolean>` would make polling correctly report `isRefetching` for users who don't yet have a purchase, which is the *real* shape of the state — "we already loaded, we're just checking again".

That change would make every consumer's polling + empty-state combination jank-free, not just this example. It's backwards-compatible because `loading` is strictly less aggressive — existing consumers that only watch `loading` would see fewer spurious true/false cycles, which is a strict improvement.

## Verification

1. `pnpm --filter @example/mcp-checkout-app dev`
2. In `basic-host`, open the MCP App with a user that has no purchase.
3. Observe: on mount, card shows "Loading purchase…" once, then the Upgrade card. No further loading cards on subsequent polls (DevTools → Components → confirm `CheckoutBody` doesn't unmount/remount).
4. Click Upgrade → card immediately swaps to Awaiting body. Spinner animation keeps running continuously through multiple polls (no restart).
5. Complete payment → the *next* poll flips the card to "You're on the X plan" in one update, no intermediate flash.
6. Inspect the outer `<div>` in DevTools: its React fiber identity is preserved across polls (pin it, trigger a poll, confirm same fiber).
