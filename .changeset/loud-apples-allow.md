---
'@solvapay/core': minor
'@solvapay/react': patch
'@solvapay/server': patch
---

Free plans with an included allowance now count usage and label the meter correctly.

`@solvapay/core` adds `countsUsage` (per-unit charge, tier, or limit) and `meterName`
(per-unit charge's meter, else the first limit's meter). A free tier with a bare
limit is not priced per unit, but it still needs a usage counter and a meter noun —
`isMetered` on the wire was the wrong question for both.

`planMeterName` uses the new reader, so a recurring allowance no longer renders the
literal "units". `useAutoActivateFreePlan` no longer requires deprecated `freeUnits`
on the plan row. Usage surfaces (`useUsage`, `getUsageCore`, plan cards) derive
from `options[]` instead of trusting `planSnapshot.isMetered` alone.
