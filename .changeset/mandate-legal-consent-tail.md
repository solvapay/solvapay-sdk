---
'@solvapay/react': minor
---

MandateText now always names SolvaPay's Terms of Service and Privacy Policy, and adds the merchant's own pair only when set.

`MandateContext` gains `solvapay: { termsUrl, privacyUrl }`. Mandate link labels live on `copy.legal.{termsOfService, privacyPolicy}`; `copy.legalFooter` stays the short footer strip. Custom `copy.mandate` templates no longer receive SolvaPay URLs on `ctx.merchant.termsUrl` / `privacyUrl` when the merchant has none — those fields are now merchant-only.
