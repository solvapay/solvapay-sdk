---
'@solvapay/mcp': patch
---

The protected-resource document is also served at its RFC 9728 path-suffixed URL, `/.well-known/oauth-protected-resource/mcp` (the well-known path with the MCP endpoint's path appended), by `createSolvaPayMcpFetch` and the Express `createMcpOAuthBridge`. Clients that start from the endpoint URL ask for it first and got a 404, then fell back to the root. It is the same document as at the root, with the public base URL as the resource, so tokens are bound alike whichever URL a client found. A custom `mcpPath` moves the suffix with it.
