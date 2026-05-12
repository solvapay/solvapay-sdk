---
'@solvapay/react': patch
---

Fix `usePaywallResolver` so `payment_required` gates carrying a `balance.creditsPerUnit` block resolve once the customer's wallet covers the next unit. This makes topup-shaped 402s (where the customer already has an active usage-based plan) dismiss automatically after a successful topup, instead of leaving consumers stuck on a static success surface.

A topup creates a balance transaction, not a paid plan purchase, so `hasPaidPurchase` would never flip on subsequent topups. Treating the attached `balance` block the same way the `activation_required` branch does fixes the post-topup auto-dismiss for `<PaywallNotice.Root onResolved>` consumers.
