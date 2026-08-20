---
'@solvapay/core': minor
---

Business-details and seller-identity validation now share a single Stripe Tax buyer jurisdiction list (`tax-jurisdictions`), so tax-ID formats, labels, and supported countries match what the platform accepts at checkout. Country-aware tax-ID validation covers every jurisdiction Stripe Tax registers in rather than the previous hand-maintained subset.
