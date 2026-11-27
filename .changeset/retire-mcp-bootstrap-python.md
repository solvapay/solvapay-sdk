---
'@solvapay/python': patch
---

Breaking: `ApiClient.bootstrap_mcp_product` and `AsyncApiClient.bootstrap_mcp_product` are removed, along with the `McpBootstrapDto`, `McpBootstrapResult`, `Tool` and `AutoMappedTool` models. The generator renumbers the models that follow them in `solvapay.models`: `Plan2` is now `Plan1`, and `Options27` to `Options35` are now `Options18` to `Options26`. SolvaPay is retiring Managed MCP: `POST /v1/sdk/products/mcp/bootstrap` now answers 410 Gone, and so does `create_product` with `isManagedMcp` set. Create products with `create_product`, and add payments to your MCP server with `solvapay.mcp`. `configure_mcp_plans` stays for existing Managed MCP products until they reach end of service.
