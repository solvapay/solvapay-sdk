---
'@solvapay/mcp-core': patch
'@solvapay/mcp': patch
---

Remove unused `applyHideToolsByAudience` / `defaultIsChatGptRequest` exports. Audience filtering is the engine `tools/list` path via `hideAudiences`.
