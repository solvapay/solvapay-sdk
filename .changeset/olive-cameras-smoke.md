---
'@solvapay/react': major
'@solvapay/server': minor
---

`PurchaseInfo` is now the generated `SdkPurchaseResponse`, and usage caps come from the limits endpoint.

The purchase row the backend actually sends had drifted from the hand-written
`PurchaseInfo` interface. Both packages now derive it from the OpenAPI schema, so
the type matches the wire.

The type changes below are source-breaking for anyone constructing a `PurchaseInfo`.
`@solvapay/server` still ships them as a minor: it stays inside the 2.x line that the
in-flight SDK alignment targets, and no integrator is pinned to the old shape yet.

**Breaking — fields removed from the purchase row.** `planType` is gone from both
the purchase and its `planSnapshot`; derive the label from `isRecurring` and the
frozen `options[]` (`countsUsage` / `billingCycle`) instead of a stored
`isMetered` flag. `planSnapshot` also drops `limit`, `meterRef`, `meterId`,
`freeUnits`, and `creditsPerUnit` — the backend never populated them on this
route. Read the per-unit credit rate off the plan (`usePlans`), and the cap off
`useLimits`.

**Breaking — fields now required.** `createdAt`, `customerRef`, `currency`,
`amount`, and `isRecurring` are required on a purchase; `currency` and `price` are
required on `planSnapshot`. Code that constructs a `PurchaseInfo` (test fixtures,
stub clients, custom transports) must supply them.

**Fixed — credit-gated plans no longer report as unlimited.** `useUsage().isUnlimited`
was `usage.total === null`, and once the cap left the plan snapshot that was true for
every metered plan — including pay-as-you-go, which is capped by the credit balance.
It now reflects the backend's unlimited signal from `useLimits`, so an unknown cap is
no longer mistaken for an absent one. `useUsage` sources `total`, `remaining`,
`percentUsed`, and `meterRef` from the same place, which costs one cached limits
request for metered plans. `getUsageCore` does the same server-side.
