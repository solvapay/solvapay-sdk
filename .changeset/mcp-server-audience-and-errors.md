---
'@solvapay/release-train': patch
---

`createSolvaPayMcpServer` takes `mcpPath` (default `/mcp`) and checks a bearer's audience against the public origin plus that path, as the Express and fetch OAuth bridges in front of it do. Before, the server expected the bare origin, so a token the bridge had accepted was refused inside the server: the SolvaPay tools (`account`, `activate_plan` and the payment tools) were missing from `tools/list` and failed when called.

An engine error now reaches the client as a JSON-RPC error. It used to be returned as a result object carrying an `error` field.
