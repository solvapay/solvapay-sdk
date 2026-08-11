---
'@solvapay/react': patch
---

Widen the `@solvapay/mcp-core` peer range to `^0.2.8 || ^0.3.0`. This package consumes only stable type and constant exports from `@solvapay/mcp-core` and does not touch the `hideToolsByAudience` surface or zod schema construction that changed in `0.3.0`, so it stays installable against both lines and `mcp-core@0.3.0` does not force a false-major cascade here or onto `@solvapay/react-supabase`.
