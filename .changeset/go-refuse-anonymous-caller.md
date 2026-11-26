---
'@solvapay/go': patch
---

`Paywall.Decide` refuses a call whose `CustomerRef` is empty or `"anonymous"` with `identity_required` (401) before calling SolvaPay, on paid checks as it already did on free allowances. Before, `"anonymous"` was sent to the API, which has no such customer and answered 404. Matches the TypeScript SDK.
