---
'@solvapay/mcp': patch
'@solvapay/mcp-core': patch
---

Thin MCP engine hosts now advertise merchant payable tools in `tools/list` when they send descriptor objects on `payableTools`. Bare string names stay dispatch-only so existing TypeScript/Python/Go catalog merges are unchanged. Ruby, Rust, Python ASGI, and the TypeScript raw `engine:` host forward title, description, and input schema.
