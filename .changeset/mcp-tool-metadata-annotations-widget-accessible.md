---
"@solvapay/mcp-core": patch
"@solvapay/mcp": patch
---

Intent tools (`upgrade`, `topup`, `manage_account`) are now annotated `{ readOnlyHint: true, idempotentHint: true }` — they only open the UI or return a read-only bootstrap snapshot. UI-only transport tools dual-stamp `_meta.ui.visibility: ["app"]` and `_meta["openai/widgetAccessible"]: true` so the embedded iframe can invoke them on the ChatGPT Apps SDK runtime.
