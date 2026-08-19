---
'@solvapay/server': minor
'@solvapay/react': minor
---

Prefer `meterName` over the deprecated `usageType` on `payable()` options, paywall metadata, and `checkLimits`. `usageType` stays accepted as an alias and is now typed as `string` rather than `'requests' | 'tokens'`, so a custom meter name type-checks on either field.

React copy uses the meter noun (`{unit}`) instead of generic "calls" / "messages", and `useUsage` falls back from `meterRef` to `meterId` when resolving the meter off a plan snapshot.
