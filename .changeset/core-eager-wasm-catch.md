---
'@solvapay/core': patch
---

Swallow rejection from the eager `@solvapay/core/browser-wasm` warm-up so Node/SSR/test evaluation of `@solvapay/react` (which side-effect-imports it) no longer produces an unhandled rejection. Explicit `warmBrowserCoreWasm()` callers still observe failures and can retry.
