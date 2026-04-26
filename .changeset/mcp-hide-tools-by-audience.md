---
'@solvapay/mcp': minor
'@solvapay/mcp-core': minor
---

**`hideToolsByAudience` — first-class way to hide UI-only virtual
tools from `tools/list` without breaking `tools/call`.**

Adds a new `hideToolsByAudience?: string[]` option to
`CreateSolvaPayMcpServerOptions`. After registration, the factory
wraps the server's `tools/list` handler to drop any tool whose
`_meta.audience` matches one of the supplied values. The tools stay
`enabled: true` so `tools/call` still reaches their handlers — the
option only affects the `tools/list` response shape.

```ts
const server = createSolvaPayMcpServer({
  solvaPay,
  productRef: 'prd_video',
  resourceUri: 'ui://my-app/mcp-app.html',
  readHtml,
  publicBaseUrl,
  // Hide transport tools (create_payment_intent, process_payment,
  // create_checkout_session, cancel_renewal, reactivate_renewal,
  // create_customer_session, create_topup_payment_intent) from the
  // LLM's tool catalogue — the iframe can still invoke them for
  // server-side work.
  hideToolsByAudience: ['ui'],
})
```

Use `['ui']` when deploying to a text-host MCP client (Claude
Desktop, MCPJam, ChatGPT connectors) that won't embed the SolvaPay
iframe surface. The LLM then sees only the four intent tools
(`upgrade` / `manage_account` / `activate_plan` / `topup`) plus any
merchant-registered data tools.

The shared implementation (`applyHideToolsByAudience`) is exported
from `@solvapay/mcp-core` so parallel adapters
(`@solvapay/mcp-fetch`) can apply the same filter without
re-implementing the `_requestHandlers` reach-in — see the new
unified `createSolvaPayMcpFetch` factory in `@solvapay/mcp-fetch`
for the edge-runtime equivalent.
