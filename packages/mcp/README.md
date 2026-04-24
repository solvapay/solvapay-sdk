# @solvapay/mcp

Framework-neutral MCP (Model Context Protocol) contracts for the SolvaPay SDK.

This package owns the shapes that cross the SolvaPay server ↔ client ↔
adapter boundary: tool names, descriptor builder, paywall `_meta.ui`
envelope, Stripe CSP baseline, bootstrap payload, OAuth bridge, JWT
bearer helpers.

It does **not** depend on `@modelcontextprotocol/sdk` or
`@modelcontextprotocol/ext-apps`. That lives in `@solvapay/mcp-sdk` —
one of several adapter packages that can consume the same descriptor
contract.

## Install

```bash
pnpm add @solvapay/mcp @solvapay/server
```

## What's in the box

| Export | Use when |
|---|---|
| `MCP_TOOL_NAMES`, `McpToolName` | You're implementing a SolvaPay MCP transport tool on any framework and need the canonical tool names |
| `buildSolvaPayDescriptors(opts)` | You're writing an MCP adapter (`mcp-lite`, `fastmcp-node`, raw JSON-RPC) and want the full SolvaPay tool surface as descriptor objects |
| `buildPayableHandler(solvaPay, ctx, handler)` | You're hand-rolling a paywall-protected tool and need the `_meta.ui` envelope auto-attached on paywall results |
| `paywallToolResult(errOrGate, ctx)` | You have a `PaywallError` (legacy `try/catch`) or a `PaywallStructuredContent` gate from `paywall.decide()` and want to return it with the right `_meta.ui` + `BootstrapPayload` |
| `buildPaywallUiMeta({ resourceUri, toolName })` | You're building the `_meta.ui` envelope yourself |
| `SOLVAPAY_DEFAULT_CSP`, `mergeCsp(overrides)` | You're registering the SolvaPay UI resource and want the Stripe allow-list baked in |
| `createMcpOAuthBridge(opts)` | You're hosting your own MCP server and need the `/oauth/*` + `/.well-known/*` middleware stack |
| `buildAuthInfoFromBearer(header, opts)` | You're plugging a raw `Authorization: Bearer …` header into an MCP `authInfo` envelope |
| `McpBearerAuthError`, `extractBearerToken`, `decodeJwtPayload`, `getCustomerRefFromJwtPayload`, `getCustomerRefFromBearerAuthHeader` | Low-level JWT bearer parsing — no signature verification (validate upstream first) |

## Typical usage

If you're starting a new SolvaPay MCP server on the official
`@modelcontextprotocol/sdk`, don't use this package directly — use
`@solvapay/mcp-sdk` which wraps it with one-call ergonomics.

If you're writing a new adapter (mcp-lite, fastmcp, custom JSON-RPC):

```ts
import { buildSolvaPayDescriptors } from '@solvapay/mcp'

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

- [`@solvapay/mcp-sdk`](../mcp-sdk) — official `@modelcontextprotocol/sdk` + `ext-apps` adapter (`createSolvaPayMcpServer`)
- [`@solvapay/server`](../server) — core SDK (paywall, webhooks, `*Core` helpers)
- [`@solvapay/react/mcp`](../react) — React provider + views for the MCP App UI shell
