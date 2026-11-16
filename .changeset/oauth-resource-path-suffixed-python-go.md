---
'@solvapay/python': patch
'@solvapay/go': patch
---

The protected-resource document is also served at its RFC 9728 path-suffixed URL, `/.well-known/oauth-protected-resource/mcp`, following a custom MCP path, as in `@solvapay/mcp`. It is the same document as at the root, so tokens are bound alike whichever URL a client found. Adopts the two new merchant-sign-in conformance cases.
