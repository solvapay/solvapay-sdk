---
'@solvapay/mcp': patch
'@solvapay/mcp-core': patch
---

Widen the `@solvapay/server` peer dependency range to `^1.4.0 || ^2.0.0`. Both packages consume only stable `@solvapay/server` exports (paywall helpers, nudge builders, the `SolvaPay` type) and are unaffected by the auto-recharge breaking change in `@solvapay/server@2.0.0`. Declaring the wider range keeps them installable against both `server@1.x` and `server@2.x`, so a `server` major no longer forces a false-major cascade onto `@solvapay/mcp` / `@solvapay/mcp-core` (and onward to `@solvapay/react` / `@solvapay/react-supabase`).
