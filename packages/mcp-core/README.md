# @solvapay/mcp-core

Framework-neutral MCP (Model Context Protocol) contracts for the SolvaPay SDK.

This package owns the shapes that cross the SolvaPay server ↔ client ↔
adapter boundary: tool names, descriptor builder, paywall `_meta.ui`
envelope, Stripe CSP baseline, bootstrap payload, pure OAuth discovery
JSON builders, JWT bearer helpers.

It does **not** depend on `@modelcontextprotocol/sdk`,
`@modelcontextprotocol/ext-apps`, or any runtime-specific HTTP plumbing.
The official `@modelcontextprotocol/*` adapter lives in
[`@solvapay/mcp`](../mcp); Node `(req, res, next)` OAuth middleware lives
in [`@solvapay/mcp-express`](../mcp-express); fetch-first OAuth + the
turnkey handler lives in [`@solvapay/mcp-fetch`](../mcp-fetch).

## Install

```bash
pnpm add @solvapay/mcp-core @solvapay/server
```

## What's in the box

| Export | Use when |
|---|---|
| `MCP_TOOL_NAMES`, `McpToolName` | You're implementing a SolvaPay MCP transport tool on any framework and need the canonical tool names |
| `buildSolvaPayDescriptors(opts)` | You're writing an MCP adapter (`fastmcp`, raw JSON-RPC) and want the full SolvaPay tool surface as descriptor objects |
| `buildPayableHandler(solvaPay, ctx, handler)` | You're hand-rolling a paywall-protected tool and need the `_meta.ui` envelope auto-attached on paywall results |
| `paywallToolResult(errOrGate, ctx)` | You have a `PaywallError` (legacy `try/catch`) or a `PaywallStructuredContent` gate from `paywall.decide()` and want to return it with the right `_meta.ui` + `BootstrapPayload` |
| `buildPaywallUiMeta({ resourceUri, toolName })` | You're building the `_meta.ui` envelope yourself |
| `SOLVAPAY_DEFAULT_CSP`, `mergeCsp(overrides)` | You're registering the SolvaPay UI resource and want the Stripe allow-list baked in |
| `getOAuthAuthorizationServerResponse(opts)`, `getOAuthProtectedResourceResponse(url)` | You're serving the `.well-known/*` discovery JSON from any runtime |
| `buildAuthInfoFromBearer(header, opts)` | You're plugging a raw `Authorization: Bearer …` header into an MCP `authInfo` envelope |
| `McpBearerAuthError`, `extractBearerToken`, `decodeJwtPayload`, `getCustomerRefFromJwtPayload`, `getCustomerRefFromBearerAuthHeader` | Low-level JWT bearer parsing — no signature verification (validate upstream first) |

## Typical usage

If you're starting a new SolvaPay MCP server on the official
`@modelcontextprotocol/sdk`, don't use this package directly — use
[`@solvapay/mcp`](../mcp), which wraps it with one-call ergonomics.

If you need HTTP-level OAuth handlers, pair this package with either
[`@solvapay/mcp-express`](../mcp-express) (Node) or
[`@solvapay/mcp-fetch`](../mcp-fetch) (Deno / Supabase Edge / Cloudflare
Workers / Bun / Next edge).

If you're writing a new adapter (fastmcp, custom JSON-RPC):

```ts
import { buildSolvaPayDescriptors } from '@solvapay/mcp-core'

const { tools, resource } = buildSolvaPayDescriptors({
  solvaPay,
  productRef: 'prd_video',
  resourceUri: 'ui://my-app/mcp-app.html',
  readHtml: async () => readFileSync('./dist/mcp-app.html', 'utf-8'),
  publicBaseUrl: 'https://my-app.example.com',
})

for (const tool of tools) {
  myAdapter.registerTool(tool.name, tool)
}
myAdapter.registerResource(resource)
```

## Peer dependencies

| Peer | Why | Optional? |
|---|---|---|
| `@solvapay/server` | Runtime `*Core` helpers + `SolvaPay`, `PaywallError`, `PaywallStructuredContent` types | Yes — only consumed by `buildSolvaPayDescriptors`, `buildPayableHandler`, `paywallToolResult` |
| `zod` | Descriptor `inputSchema` shape | Yes — descriptor consumers decide whether to use zod |

## See also

- [`@solvapay/mcp`](../mcp) — official `@modelcontextprotocol/sdk` + `ext-apps` adapter (`createSolvaPayMcpServer`)
- [`@solvapay/mcp-express`](../mcp-express) — Node `(req, res, next)` OAuth middleware stack
- [`@solvapay/mcp-fetch`](../mcp-fetch) — fetch-first OAuth handlers + turnkey `createSolvaPayMcpFetchHandler`
- [`@solvapay/server`](../server) — core SDK (paywall, webhooks, `*Core` helpers)
- [`@solvapay/react/mcp`](../react) — React provider + views for the MCP App UI shell
