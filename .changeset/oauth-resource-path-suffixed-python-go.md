---
'@solvapay/python': patch
'@solvapay/go': patch
---

The protected-resource document is also served at its RFC 9728 path-suffixed URL, `/.well-known/oauth-protected-resource/mcp`, following a custom MCP path, as in `@solvapay/mcp`. There the resource is the endpoint URL (`https://host/mcp`), as RFC 9728 §3.3 requires; the root document still names the public base URL. Adopts the two merchant-sign-in conformance cases.
