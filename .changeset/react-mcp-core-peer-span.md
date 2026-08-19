---
'@solvapay/react': patch
---

Widen the `@solvapay/mcp-core` peer range to `^0.2.8 || ^0.3.0`, so this package stays installable against both lines. It consumes only stable type and constant exports and does not touch the `hideToolsByAudience` surface or zod schema construction that changed in `0.3.0`.
