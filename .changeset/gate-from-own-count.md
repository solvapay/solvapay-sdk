---
'@solvapay/server': patch
---

A call gated by the SDK's own count now says so. When the last cached unit was already used, or more parallel calls arrived than units remained, `paywall.decide()` built the gate from the limits response it had counted down, which still said units were left. The customer was told they had no active plan (`upgrade_required`, with `remainingCalls` above 0). The gate now reads `limit_reached` with `remainingCalls: 0`, like a gate from the API.
