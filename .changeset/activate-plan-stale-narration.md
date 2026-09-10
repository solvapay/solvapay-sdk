---
'@solvapay/mcp-core': patch
'@solvapay/release-train': patch
---

Account narration now trusts `limits.planRef` when the purchase list is empty, so a just-enrolled or just-activated customer is no longer described as having no plan. Bootstrap refetches the purchase list when limits names a purchase the parallel snapshot missed, and credit top-ups are filtered on `origin`.
