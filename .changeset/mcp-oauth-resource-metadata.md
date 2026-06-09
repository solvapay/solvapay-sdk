---
"@solvapay/mcp-core": patch
---

Preserve OAuth resource metadata in bearer auth by exposing `extra.resource`, instead of inferring MCP client identity from resource-only `aud` claims.
