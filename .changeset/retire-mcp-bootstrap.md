---
'@solvapay/server': patch
---

Breaking: `bootstrapMcpProduct` is removed from `createSolvaPay` and `createSolvaPayClient`, along with the `McpBootstrapRequest`, `McpBootstrapResponse`, `McpBootstrapPlanInput` and `ToolPlanMappingInput` types. SolvaPay is retiring Managed MCP: `POST /v1/sdk/products/mcp/bootstrap` now answers 410 Gone, and so does `createProduct` with `isManagedMcp: true`. Create products with `createProduct`, and add payments to your MCP server with `@solvapay/mcp`. `configureMcpPlans` stays for existing Managed MCP products until they reach end of service.
