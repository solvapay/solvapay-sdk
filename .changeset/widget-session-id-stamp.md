---
'@solvapay/mcp-core': patch
---

Stamp a fresh `_meta["openai/widgetSessionId"]` UUID on every intent-tool response (`topup`, `upgrade`, `manage_account`, plus the `activate_plan` picker bootstrap). This is a forward-looking workaround for a separate ChatGPT MCP connector bug where the host returns `-32000 MCP Resource not found` on the second `tools/call` of a session even though the call never reaches the server. Stamping a UUID per invocation gives the host a routing key that changes every call, which the [OpenAI Apps SDK community thread](https://community.openai.com/t/connector-tool-calls-generating-fresh-mcp-session-each-invocation/1364975) reports unsticks the failure mode.

Matches the shape used by [`openai/openai-apps-sdk-examples`'s `shopping_cart_python`](https://github.com/openai/openai-apps-sdk-examples) server. Safe on any host that doesn't consume the key. Removable once the upstream bug ships a fix.
