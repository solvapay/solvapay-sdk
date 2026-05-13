---
'@solvapay/server': minor
'@solvapay/react': minor
---

Add `useLimits` — a backend-authoritative hook for rendering "X left" pills against any (product, meter) pair.

The runtime portion of the backend's `LimitResponse` (the same data `paywall.decide()` consults internally on every gated request) is now exposed read-only so consumers can render an honest counter without reinventing the math client-side. Replaces two common patterns:

- `floor(useBalance().credits / plan.creditsPerUnit)` for prepaid usage-based products.
- `messageLimit - userMessageCount` local refs for free-tier products.

Both collapse onto one source of truth.

### `@solvapay/react`

```tsx
import { useLimits } from '@solvapay/react'

const { remaining, withinLimits, refetch, adjustRemaining } = useLimits({
  productRef: 'prd_api',
  meterName: 'requests', // optional; defaults to 'requests'
})
```

The minimal projection (`remaining`, `withinLimits`, `meterName`, `activationRequired`) is intentional — `plans` / `balance` / `productDetails` are already surfaced by `usePlans` / `useBalance` / paywall structured content.

`activationRequired: true` distinguishes "free tier waiting to be claimed" from "exhausted" — both look like `remaining: 0` on the wire, but only the latter should drive an "Upgrade" CTA. Pair with `useActivation` to flip the customer onto the free tier when the backend's default plan needs explicit activation:

```tsx
const { activationRequired } = useLimits({ productRef })
const { activate } = useActivation()
const freePlan = plans.find(p => !p.requiresPayment && (p.freeUnits ?? 0) > 0)

useEffect(() => {
  if (activationRequired === true && freePlan?.reference) {
    activate({ productRef, planRef: freePlan.reference })
  }
}, [activationRequired, freePlan?.reference, productRef, activate])
```

`adjustRemaining(delta)` mirrors `useBalance().adjustBalance` — applies an 8 s optimistic grace window then auto-refetches. Use after a successful gated action so the pill snaps before the trailing refetch lands. Module-level cache keyed by `customerRef:productRef:meterName` with a 10 s TTL that mirrors the backend paywall's `limitsCacheTTL`. When the transport doesn't implement `getLimits` (e.g. an MCP adapter without the route), the hook returns `null` for `remaining` / `withinLimits` with `loading: false` — graceful fallback matching `useUsage`'s behaviour when `getUsage` is absent.

### `@solvapay/server`

New `checkLimitsCore(request, options)` route helper mirrors `listPlansCore` — reads `productRef` (required) and `meterName` (optional) from query string, authenticates via `getAuthenticatedUserCore`, returns the full `LimitResponseWithPlan`. Reachable from both `@solvapay/server` and `@solvapay/server/edge`.

### Transport layer

`SolvaPayTransport` gains an optional `getLimits({ productRef, meterName? })` method (parallel to `getBalance` / `getUsage`). The default HTTP transport routes to `GET /api/limits` (configurable via `SolvaPayConfig.api.getLimits`).

### `useAutoActivateFreePlan`

New hook that encapsulates the "silently activate the free plan when the backend reports `activationRequired: true`" pattern from the demo. Pairs `useLimits`, `usePlans`, and `useActivation` behind a one-shot guard keyed by `${customerRef}:${productRef}` so failed activations don't retry on every render. Returns `{ pending, activated, error }` — use `pending` as a skeleton gate so the UI doesn't flash "0 left" between the limits fetch and the post-activation refetch.

```tsx
import { useAutoActivateFreePlan } from '@solvapay/react'

const { pending: autoActivating } = useAutoActivateFreePlan({ productRef })

<UsagePill loading={autoActivating || limitsLoading} remaining={limitRemaining} />
```

When the product has no free plan to activate (e.g. a PAYG-only product whose default plan needs activation but is paid), `pending` stays `false` so the consumer commits to the backend's actual `remaining` instead of stalling on a skeleton.

### `usePlans` in-flight cache fix

Reordered the cache check so the in-flight branch wins over the fresh-cache branch. Previously two sibling `usePlans` calls against the same `productRef` could race: the second caller hit the fresh-cache branch (the in-flight slot carries `plans: []` + a fresh timestamp) and locked itself into "loading=false, plans=[]" until the TTL expired. The in-flight branch now coalesces correctly, and the fresh-cache branch only matches when `plans.length > 0`. Behaviour is unchanged for single-mount use; concurrent callers no longer need a workaround.

### Non-breaking

All additions are additive: `useBalance` / `useUsage` are unchanged, `getLimits` is optional on the transport interface so existing custom transports keep working without modification, and the `usePlans` cache reorder is a strict bugfix (no API change).
