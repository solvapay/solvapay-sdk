---
'@solvapay/python': patch
'@solvapay/go': patch
'create-solvapay': patch
---

The Python and Go MCP servers are stateless by default, as the TypeScript server is.

- Python `http_app()` and Go `Handler()` issue no `mcp-session-id`, and a request needs no earlier `initialize` on the same instance. In-memory sessions broke once a load balancer spread one client over several instances, and clients that send one request per call got `400 Missing session ID` (Python) or `method "tools/list" is invalid during session initialization` (Go). For sessions, pass `http_app(stateless_http=False)` in Python or set `MCPServerOptions.Stateful` in Go, on a single instance or with sticky routing.
- The Python and Go scaffolds from `create-solvapay` pass `hide_tools_by_audience=["ui"]` / `HideToolsByAudience: []string{"ui"}`, as the TypeScript template does, so the widget's own tools stay out of `tools/list` and `solvapay verify` passes on a fresh scaffold. The MCP guides' first example does the same.
