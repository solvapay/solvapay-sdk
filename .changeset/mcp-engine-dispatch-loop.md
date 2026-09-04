---
'@solvapay/mcp': minor
'@solvapay/mcp-core': minor
---

JSON `POST /mcp` on the fetch (and Express) factories now routes through `mcpDispatch` / `mcpResume`. Builtin tool handlers, bootstrap payload builders, and host-local descriptor registration are removed; `onToolCall` / `onToolResult` fire around the whole dispatch with tool name `'*'`.
