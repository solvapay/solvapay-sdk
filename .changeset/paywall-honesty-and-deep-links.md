---
'@solvapay/server': minor
'@solvapay/mcp-core': patch
'@solvapay/mcp': patch
'@solvapay/react': patch
'@solvapay/core': patch
'@solvapay/server-native': patch
'@solvapay/server-wasm': patch
---

Classify each SDK paywall denial honestly and name the recovery. Credit shortfalls report balance, cost and shortfall instead of "no active plan"; included-usage exhaustion reaches `limit_reached`; failed auto-upgrades keep `upgrade_required` with distinct copy. Gate messages append a named per-plan checkout ladder when the backend sends `plans[].checkoutUrl`.

The classifier now lives in `solvapay-core` and ships to all six language surfaces. The `account` tool no longer crashes on a successful limits check (the backend never sends `plan`). Tool errors now validate against the registered output schema so hosts report the real message instead of `-32602`. `attach_business_details` accepts every backend tax ID type. `already_purchased` completes activation. Top-up no longer invents a 100-credit peg when `creditsPerMinorUnit` is missing.
