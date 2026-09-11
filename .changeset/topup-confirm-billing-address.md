---
'@solvapay/react': patch
'@solvapay/release-train': patch
---

Credit top-ups and auto-recharge card setup now send Stripe the billing address the Payment Element is configured not to collect, tax attach receives the buyer's state and postal code, `TopupForm` honours the documented `appearance` prop again, and a failed confirm on any surface shows its error instead of leaving the button stuck on "Processing…".
