---
'@solvapay/mcp-fetch': minor
---

**`createSolvaPayMcpFetch` — descriptor-accepting unified factory for
edge runtimes.**

New top-level export that collapses the previous two-package dance
(build `McpServer` in `@solvapay/mcp`, wrap in
`createSolvaPayMcpFetchHandler`) into a single call:

```ts
import { createSolvaPayMcpFetch } from '@solvapay/mcp-fetch'

Deno.serve(
  createSolvaPayMcpFetch({
    solvaPay,
    productRef,
    resourceUri: 'ui://my-app/mcp-app.html',
    readHtml: () => Deno.readTextFile('./mcp-app.html'),
    publicBaseUrl,
    apiBaseUrl,
    mode: 'json-stateless',
    hideToolsByAudience: ['ui'],
    additionalTools: ({ server }) => {
      // merchant tool registration here
    },
  }),
)
```

The factory accepts every option on `BuildSolvaPayDescriptorsOptions`
(descriptor construction) + every option on
`CreateSolvaPayMcpFetchHandlerOptions` (handler wiring) except
`server` — it builds the `McpServer` internally via the same
descriptor loop `createSolvaPayMcpServer` uses in `@solvapay/mcp`.

**Architectural motivation:** `@solvapay/mcp-core`'s module-level
comment describes `@solvapay/mcp`, `@solvapay/mcp-express`, and
`@solvapay/mcp-fetch` as PARALLEL adapters onto the descriptor
bundle, not stacked layers. Until this change, edge consumers
(Supabase Edge, Cloudflare Workers, Vercel Edge, Deno, Bun) had to
also install `@solvapay/mcp` just to call
`createSolvaPayMcpServer(...)` and pass the result in — contradicting
the stated design. `createSolvaPayMcpFetch` closes the gap so edge
consumers can import ONLY from `@solvapay/mcp-fetch`.

**Peer-dep change:** `@solvapay/mcp-fetch` now lists
`@modelcontextprotocol/ext-apps` (`^1.5.0`) and `@solvapay/server`
as peer dependencies (previously only used via the caller-provided
`McpServer`). The previously-optional `@solvapay/mcp` peer is
removed — BYO-server callers using
`createSolvaPayMcpFetchHandler({ server, ... })` directly still work
unchanged; they just need to install `@solvapay/mcp` themselves
(which they were already doing to build the server).

The existing `createSolvaPayMcpFetchHandler` (+ `server:` argument)
stays on the public API surface for consumers who want to bring
their own `McpServer` with a custom tool set.
