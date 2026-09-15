---
'@solvapay/release-train': major
---

`PaywallError` is now a `SolvaPayError` (`code: 'paywall'`, no `status`). Catch paywall first when you also catch `SolvaPayError`. Balance-poll delay tables are core bindings — do not keep local copies of `TOPUP_BALANCE_POLL_DELAYS_MS` / `BALANCE_RECONCILE_DELAYS_MS`.
