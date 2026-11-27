---
'@solvapay/go': patch
---

Breaking for `github.com/solvapay/solvapay-sdk/go/api`: the generated `McpBootstrapDto` and `McpBootstrapResult` types are removed. SolvaPay is retiring Managed MCP, and `POST /v1/sdk/products/mcp/bootstrap` now answers 410 Gone. Add payments to your MCP server with the SDK's MCP support.
