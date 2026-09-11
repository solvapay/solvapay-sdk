---
'@solvapay/core': minor
'@solvapay/react': minor
---

Move checkout VAT labels and price formatting into Rust core helpers. Checkout money strings are locale-independent (`€10` instead of `10,00 €`); zero VAT still renders as `$0`, never `Free`.
