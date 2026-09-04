---
'@solvapay/mcp-core': patch
'@solvapay/mcp': patch
---

`hideToolsByAudience` now rejects `tools/call` for hidden tools (`-32601`) and no longer restores the catalog for a spoofable `openai-mcp` User-Agent. MCP Apps hosts should rely on SEP-1865 `_meta.ui.visibility` for iframe-only transport tools.
