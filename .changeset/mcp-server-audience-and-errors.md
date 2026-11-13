---
'@solvapay/release-train': patch
---

`createSolvaPayMcpServer` takes `mcpPath` (default `/mcp`) and checks a bearer's audience against the public origin plus that path, as the Express and fetch OAuth bridges in front of it do. Before, the server expected the bare origin, so a token the bridge had accepted was refused inside the server: the SolvaPay tools (`account`, `activate_plan` and the payment tools) were missing from `tools/list` and failed when called.

An engine error now reaches the client as a JSON-RPC error. It used to be returned as a result object carrying an `error` field.

A tool registered through `registerPayable`, `registerFree` or `server.registerTool` on a SolvaPay MCP server has its arguments parsed with its input schema before the handler runs, on the Express and the fetch paths. Schema defaults reach the handler, and invalid arguments come back as a tool error. Before, the handler received the raw arguments.

The edge entry of `@solvapay/mcp` exports `VIEWER_TOOL_NAME`, `MCP_TOOL_NAMES`, `MCP_PROMPT_NAMES` and `INTENT_TOOL_NAMES`, as the Node entry does.

`@solvapay/server` loads its WASM binding before an edge importer runs. On Deno, building an MCP handler at the top of a function (the Supabase Edge layout) failed with "WASM binding is not ready". The `deno`, `workerd`, `worker` and `edge-light` conditions and `@solvapay/server/edge` resolve to a new `dist/edge-runtime.js` that awaits the load and re-exports the edge module.
