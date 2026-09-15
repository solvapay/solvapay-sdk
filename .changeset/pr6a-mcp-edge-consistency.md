---
'@solvapay/release-train': minor
---

Native MCP CORS uses one strict `scheme://…` allowlist (`mcpNativeCors`). Origins such as `cursor:x` that Python and Express previously accepted are now rejected. JSON-RPC internal errors (`-32603`) are HTTP 200; the engine envelope `status` is authoritative.
