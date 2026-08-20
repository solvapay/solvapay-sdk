---
'@solvapay/server': minor
---

Plan responses now describe pricing as a composable `options[]` array plus a derived `type` label (`recurring` | `one-time` | `usage-based` | `hybrid`). Option kinds are `charge`, `billingCycle`, `limit`, `tier`, `trial`, `prepaid`, `entitlement`, `rollover`, `discount`, and the `autoAssigned` / `hidden` markers — see the option catalog at https://docs.solvapay.com/plans/overview.

`SdkPlanResponse` drops the flat pricing fields `setupFee`, `trialDays`, `billingCycle`, `billingModel`, `creditsPerUnit`, `measures`, `meterRef`, `limit`, `rolloverUnusedUnits`, `freeUnits`, `limits`, and `hidden`; `price` is now optional and carries the derived headline amount. `SdkPlanSnapshotDto` likewise drops `planType`, `billingCycle`, `limits`, `meterRef`, `limit`, `freeUnits`, and `creditsPerUnit` in favour of a frozen `options[]`.

Read the equivalent option off `plan.options` instead. If you annotate with `components['schemas']['SdkPlanResponse']` you will get type errors on the removed fields; if you read them off a plain `listPlans()` result they are now `undefined` rather than a compile error, so check any code that branches on `plan.billingCycle` or `plan.trialDays`.

`checkLimits`, paywall decisions, and purchase payloads are unaffected — `LimitPlanItemDto`, `LimitResponse`, `LimitBalanceDto`, `SdkPurchaseResponse`, `UserInfoPlanDto`, and `ActivatePlanResponseDto` keep the flat fields they already returned.
