---
'@solvapay/server': minor
'@solvapay/react': minor
---

Prefer `meterName` over deprecated `usageType` on paywall metadata and `checkLimits`. React copy uses the meter noun (`{unit}`) instead of generic "calls"/"messages", and `useUsage` falls back from `meterRef` to `meterId`.
