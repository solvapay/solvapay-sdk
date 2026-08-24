---
'@solvapay/core': minor
'@solvapay/react': major
'@solvapay/mcp-core': patch
---

Plan pricing is read from the wire's `options[]` instead of scalar fields the backend stopped sending.

`GET /v1/sdk/products/:ref/plans` returns pricing as a composable `options[]` array
(`charge`, `billingCycle`, `limit`, `trial`) with a derived headline `price`. The SDK
was still reading `planType`, `creditsPerUnit`, `billingCycle`, `meterRef`, `limit`, and
`pricingOptions` off the plan — none of which appear in the schema. Because every test
fixture hand-wrote those fields, the suites passed while real payloads silently took the
wrong branch.

**New — `@solvapay/core` pricing-option readers.** `charges`, `headlineCharges`,
`perUnitCharge`, `billingCycle`, `trialDays`, `includedUnits`, `peggedCreditsPerUnit`,
and `creditsPerUnitFromBalance` read a plan or a frozen plan snapshot. One reader for
both the MCP text narration and the MCP UI panel, so the two agree.

**Fixed — every paid plan rendered as a one-time payment.** The billing cycle now comes
from the `billingCycle` option, so subscriptions show the `/month` suffix and the
"start your _plan_ plan" payment copy again instead of "complete the purchase".

**Fixed — plan labels.** `narrate` derives the label from `type` plus `requiresPayment`,
so one-time, hybrid ("subscription + usage"), pay-as-you-go, and free plans are no longer
all labelled "recurring". `'free'` and `'trial'` were never backend plan types: a free
plan is `requiresPayment: false` and a trial is a `trial` option. The upgrade surface
filters on `requiresPayment`, which stops it offering a $0 plan.

**Fixed — "Cost per call" was absent, and the credit figure was wrong.** The rate is a
per-unit charge in **minor units**, not credits, so converting needs the wallet's peg
(`creditsPerMinorUnit` and `displayExchangeRate`). The row is emitted only when the
charge currency matches `balance.displayCurrency` — the peg carries no cross-currency
rate, so anything else would be wrong by the FX ratio. With no balance to peg against,
PAYG surfaces show the charge itself (`$0.02 / call`) rather than inventing a credit
count.

**Fixed — included allowance counted the wrong thing.** It is the `limit` option's `cap`,
counted in metered items, and it is labelled with the plan's meter. `0` is the backend's
unlimited sentinel and is no longer shown as an allowance of zero.

**Fixed — pay-as-you-go resolved as a free plan.** `resolvePlanShape` keyed off
`planType`, `meterRef`, `meterId`, and `limit`, so every plan fell through to its unknown
branch. A PAYG plan has no headline `price` and so came back `'free'`: no Top up action,
a Cancel action for a plan with no renewal to cancel, and the free-usage activity strip
instead of the balance. Metered subscriptions were also indistinguishable from unlimited
ones. The shape now derives from `options[]` — a billing cycle separates a subscription
from a one-off, a per-unit charge or included allowance marks it metered — and works for
both a plan and the frozen snapshot on a purchase, which carry different fields.

**Breaking — `SuccessMeta`.** `creditsIncluded` is replaced by `includedUnits` plus
`meterName`. The old field claimed credits while carrying a per-cycle item allowance.

**Breaking — `PlanLike`** (`@solvapay/react/mcp`) drops `planType`, `meterRef`,
`meterId`, and `limit` for `options`, `requiresPayment`, and `isMetered`, matching what
the backend sends.

**Deprecated on `Plan`.** `pricingOptions`, `creditsPerUnit`, `billingCycle`, `freeUnits`,
`setupFee`, `trialDays`, `limit`, and `rolloverUnusedUnits` are kept for consumers who
build plans through a custom fetcher, but the backend does not send them — read `options[]`
instead. `Plan.type` adds `'hybrid'`.
