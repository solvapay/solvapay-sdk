---
'@solvapay/mcp': patch
---

Route every MCP OAuth HTTP path through the native `mcpOauthRequest` client. Hosts must pass `oauthClient` (the SolvaPay API client); there is no TypeScript/Python local route table.
