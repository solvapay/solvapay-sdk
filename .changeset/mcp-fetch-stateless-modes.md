---
'@solvapay/mcp-fetch': minor
---

**`createSolvaPayMcpFetchHandler` — stateless-fetch-safe transport
wiring via the new `mode` + `buildTransport` options.**

Adds two additive options to
`CreateSolvaPayMcpFetchHandlerOptions`:

- `mode?: 'sse-stateful' | 'json-stateless' | 'sse-stateless'` —
  transport wiring preset. Defaults to `'sse-stateful'` (today's
  behaviour: SSE streaming + UUID `mcp-session-id` on `initialize`).
  `'json-stateless'` is what stateless fetch runtimes (Supabase
  Edge, Cloudflare Workers, Vercel Edge, Deno Deploy) want — it sets
  `{ sessionIdGenerator: undefined, enableJsonResponse: true }` on
  the underlying `WebStandardStreamableHTTPServerTransport` so the
  response wire shape is a single assembled JSON body (not an SSE
  stream that can be cut off by the per-request `transport.close()`
  in the handler's finally block).
- `buildTransport?: () => WebStandardStreamableHTTPServerTransport` —
  escape hatch for callers with bespoke transport configuration. When
  provided, `mode` / `sessionIdGenerator` are ignored; the handler
  still manages `server.connect(transport)` + `transport.close()` per
  request.

Under the hood, every mode now runs `transport.close()` in a `finally`
block so the server's `_transport` slot is released for the next
request, and concurrent requests serialise through a shared
connect-close mutex so two overlapping calls never double-connect the
same `McpServer` (previously surfaced as `"Already connected to a
transport"` on the second request).

Default behaviour for Node / Express / Bun deployments is unchanged.
Edge consumers hitting the `"Already connected"` / `"Server not
initialized"` / empty-body bugs should add `mode: 'json-stateless'`
to their `createSolvaPayMcpFetchHandler(...)` call.
