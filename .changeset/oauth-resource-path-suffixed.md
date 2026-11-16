---
'@solvapay/mcp': patch
---

The protected-resource document is also served at its RFC 9728 path-suffixed URL, `/.well-known/oauth-protected-resource/mcp` (the well-known path with the MCP endpoint's path appended), by `createSolvaPayMcpFetch` and the Express `createMcpOAuthBridge`. Clients that start from the endpoint URL ask for it first and got a 404, then fell back to the root. There the resource is the endpoint URL (`https://host/mcp`), as RFC 9728 §3.3 requires; the root document still names the public base URL, and both name this server as the authorization server. A custom `mcpPath` moves the suffix with it.
