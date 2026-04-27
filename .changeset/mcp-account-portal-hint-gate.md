---
'@solvapay/react': patch
---

`<McpAccountView>` now hides the "Click Manage account to update your card or
cancel your plan." portal hint whenever the matching `Manage account` button
itself is hidden. Previously the hint was gated only on `hasPaidPurchase`
while the button additionally required a non-zero `activePurchase.amount`,
so a customer on a paid-but-zero-amount purchase would see a hint pointing
at a CTA that never rendered. The two now share a single gate.
