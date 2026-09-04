---
'@solvapay/server': minor
'@solvapay/mcp-core': minor
'@solvapay/mcp': minor
'@solvapay/core': minor
'solvapay': minor
'solvapay-mcp': minor
'create-solvapay': patch
---

Make MCP gate and intent-tool results usable on text-only hosts across every language facade. The Rust core now defaults `mode` to `auto`, classifies an at-cap active plan as `limit_reached`, and puts a pasteable https checkout URL, plan refs, and included-usage counters on the same tool result so recovery no longer depends on an iframe.
