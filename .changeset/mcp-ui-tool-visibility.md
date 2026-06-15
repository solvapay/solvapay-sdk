---
"@solvapay/mcp-core": patch
"@solvapay/mcp": patch
---

UI-only transport tools (`create_payment_intent`, etc.) now carry SEP-1865 `_meta.ui.visibility: ["app"]` so MCP Apps hosts hide them from the model while the embedded iframe can still invoke them. The proprietary `_meta.audience: "ui"` tag remains for server-side `hideToolsByAudience` on non-SEP-1865 hosts.
