---
'@solvapay/mcp': major
'@solvapay/mcp-core': major
'@solvapay/server': major
'@solvapay/core': minor
'@solvapay/react': minor
---

Breaking MCP tool consolidation (12 → 8): `upgrade`, `manage_account`, `topup`, `create_topup_payment_intent`, `create_checkout_session`, `create_customer_session`, `cancel_renewal`, and `reactivate_renewal` are gone. Use `account`, `get_history`, and `set_renewal` instead. `create_payment_intent` now takes `purpose`, and `create_hosted_session` takes `kind`. `activate_plan` requires `planRef`.

Paywall decisions now carry `requestId`, and `trackUsage` uses an `{requestId}:{outcome}` idempotency key. Concurrent `checkLimits` calls share one in-flight fetch and consume one unit each via `evaluateClaimedLimits`. Buyer-address label helpers and country tables now come from Rust core. `deriveUsageSnapshot` is deprecated in favor of `projectUsageSnapshot`.
