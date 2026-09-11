---
'@solvapay/mcp': patch
'@solvapay/mcp-core': patch
---

The shared MCP engine now answers 2026-07-28 (`server/discover`, per-request `_meta`, SEP-2549 cache fields) while keeping claim-less `initialize` byte-stable. Engine-mode `/mcp` hosts return JSON-RPC errors instead of HTTP 500 stack traces. Native Ruby, Python, and Rust MCP packages pick this up from the shared core on their next native rebuild.
