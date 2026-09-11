---
'@solvapay/server': minor
'@solvapay/core': patch
---

Paywall hosts now follow the Rust `gate_next` / `ensure_customer_next` protocol: missing `createCustomer` fails loudly instead of returning an unresolved app ref; `trackUsage` uses the core `outcome` (including paywall vs fail) and retries `"Customer not found"`; Python and Ruby raise `Activation required` for `activation_required` gates; Go, Python, Ruby, and Rust run the same 409 create-conflict recovery TypeScript already had.
