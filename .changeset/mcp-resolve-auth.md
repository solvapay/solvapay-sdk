---
'@solvapay/mcp-core': patch
'@solvapay/mcp': patch
---

MCP bearer auth is decided in one Rust `mcpResolveAuth` op. `@solvapay/mcp-core` no longer exports `cachedJwks` / `jwksUrlFromIssuer` / `resetJwksCacheForTests`. `@solvapay/mcp` no longer accepts `fetchJwks`; pass `hs256Secret` or `jwksJson` only as local verification overrides.
