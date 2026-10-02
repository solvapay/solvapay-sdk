---
'@solvapay/server': minor
---

`GetUsageResult.used` is `number | null`. `deriveUsageSnapshot` no longer takes `used`. `PurchaseInfo.usage` is the billing period only (`periodStart`, `periodEnd`); counts come from limits.
