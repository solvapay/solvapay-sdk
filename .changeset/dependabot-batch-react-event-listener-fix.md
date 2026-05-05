---
'@solvapay/react': patch
---

Fix `McpAppFull.addEventListener`/`removeEventListener` types to accept the tighter `K extends keyof AppEventMap` shape introduced in `@modelcontextprotocol/ext-apps@^1.7`. Previously the loose `(evt: string, …)` signature on the interface didn't match what ext-apps exposes from 1.7+, so consumers seeing types from both `@solvapay/react` and `ext-apps@^1.7` would hit `TS2322: Type 'App' is not assignable to type 'McpAppFull'` at every `<McpApp app={...} />` mount site.

The interface now declares `(evt: any, …)` for both event-listener fields, which is permissive enough to satisfy the new tightened generic without giving up the legacy `ontoolresult` setter fallback. Fixes [PR #169](https://github.com/solvapay/solvapay-sdk/pull/169).
