---
'@solvapay/react': minor
---

Theme Stripe's Payment Element from live `--solvapay-*` tokens, default it to a tabs layout so a single method no longer draws an accordion box, derive input metrics from the host root so card fields match business-details controls, and replace the MCP business-details border with spacing. `TopupForm.Root` and `PaymentForm.Root` accept an optional `appearance` prop (`null` restores Stripe's default).
