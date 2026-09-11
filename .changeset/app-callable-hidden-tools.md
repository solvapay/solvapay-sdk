---
'@solvapay/mcp-core': patch
'@solvapay/mcp': patch
---

`hideToolsByAudience: ['ui']` no longer blocks the widget's `create_payment_intent` / `process_payment` calls. App-callable tools stay invocable while remaining hidden from `tools/list`.
