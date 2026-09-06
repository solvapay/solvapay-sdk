---
'@solvapay/mcp-core': patch
'@solvapay/mcp': patch
---

Make every MCP tool result independently complete on `content[].text`: serialize the payload as a trailing text block (`dataInText`, default on), emit the low-balance nudge as an embedded resource, inline the manage URL as a markdown link, and replace slash-command recovery hints with named `account` + `view` calls. `registerPayable` now accepts an opt-in `outputSchema`.
