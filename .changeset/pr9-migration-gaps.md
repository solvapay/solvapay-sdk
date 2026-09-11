---
'@solvapay/server': patch
---

Keep the public `CheckLimitsRequest` type name as an alias of OpenAPI `CheckLimitRequest` after removing the obsolete `includeCheckoutSession` overlay. The field already ships on the snapshot type; Rust consumers construct the DTO as a flat `CheckLimitRequest` (no `base` wrapper).
