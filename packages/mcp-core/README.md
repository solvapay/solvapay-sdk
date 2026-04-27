# @solvapay/mcp-core

Framework-neutral MCP (Model Context Protocol) contracts for the SolvaPay SDK.

This package owns the shapes that cross the SolvaPay server ↔ client ↔
adapter boundary: tool names, descriptor builder (for SolvaPay intent
tools, which advertise `_meta.ui.resourceUri` on `tools/list` per
SEP-1865; merchant payable tools do NOT), the `BootstrapPayload`
shape carried on `structuredContent`, Stripe CSP baseline, pure OAuth
discovery JSON builders, and JWT bearer helpers.

It does **not** depend on `@modelcontextprotocol/sdk`,
`@modelcontextprotocol/ext-apps`, or any runtime-specific HTTP plumbing.
The official `@modelcontextprotocol/*` adapter lives in
[`@solvapay/mcp`](../mcp); Node `(req, res, next)` OAuth middleware ships
as the [`@solvapay/mcp/express`](../mcp/src/express) subpath export;
fetch-first OAuth + the turnkey handler ships as the
[`@solvapay/mcp/fetch`](../mcp/src/fetch) subpath export.

## Install

```bash
pnpm add @solvapay/mcp-core @solvapay/server
```

## What's in the box

| Export                                                                                                                               | Use when                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_TOOL_NAMES`, `McpToolName`                                                                                                      | You're implementing a SolvaPay MCP transport tool on any framework and need the canonical tool names                                                                                                                                                                |
| `buildSolvaPayDescriptors(opts)`                                                                                                     | You're writing an MCP adapter (`fastmcp`, raw JSON-RPC) and want the full SolvaPay tool surface as descriptor objects                                                                                                                                               |
| `buildPayableHandler(solvaPay, ctx, handler)`                                                                                        | You're hand-rolling a paywall-protected tool and want the pre-check paywall to return a clean text-only narration on `content[0].text` + the gate on `structuredContent`                                                                                            |
| `paywallToolResult(errOrGate)`                                                                                                       | You have a `PaywallError` (legacy `try/catch`) or a `PaywallStructuredContent` gate from `paywall.decide()` and want a text-only tool result                                                                                                                        |
| `SOLVAPAY_DEFAULT_CSP`, `mergeCsp(overrides, apiBaseUrl?)`                                                                           | You're registering the SolvaPay UI resource and want the Stripe allow-list baked in. Pass `apiBaseUrl` to auto-include the configured SolvaPay API origin in `resourceDomains` + `connectDomains` so merchant branding images render without a hand-extended `csp`. |
| `getOAuthAuthorizationServerResponse(opts)`, `getOAuthProtectedResourceResponse(url)`                                                | You're serving the `.well-known/*` discovery JSON from any runtime                                                                                                                                                                                                  |
| `buildAuthInfoFromBearer(header, opts)`                                                                                              | You're plugging a raw `Authorization: Bearer …` header into an MCP `authInfo` envelope                                                                                                                                                                              |
| `McpBearerAuthError`, `extractBearerToken`, `decodeJwtPayload`, `getCustomerRefFromJwtPayload`, `getCustomerRefFromBearerAuthHeader` | Low-level JWT bearer parsing — no signature verification (validate upstream first)                                                                                                                                                                                  |

## How paywalls work

Paywall responses from `buildPayableHandler` / `paywallToolResult` are
**text-only**. `content[0].text` carries a human narration that names
the recovery intent tool (`upgrade` / `topup` / `activate_plan`) and
inlines `gate.checkoutUrl` for terminal-first hosts. `isError` is
always `false` — a gate is a user-actionable signal, not a tool
failure. `structuredContent = gate` is still emitted for programmatic
consumers.

The widget iframe is reserved for the three deliberate intent tools
(`upgrade` / `manage_account` / `topup`), which advertise
`_meta.ui.resourceUri` on their descriptors. Merchant payable tools
don't, so hosts don't open an uninvited iframe on a successful data
call or on a paywall — the LLM narrates the recovery and calls the
intent tool, which mounts the widget.

## Typical usage

If you're starting a new SolvaPay MCP server on the official
`@modelcontextprotocol/sdk`, don't use this package directly — use
[`@solvapay/mcp`](../mcp), which wraps it with one-call ergonomics.

If you need HTTP-level OAuth handlers, pair this package with either
[`@solvapay/mcp/express`](../mcp/src/express) (Node) or
[`@solvapay/mcp/fetch`](../mcp/src/fetch) (Deno / Supabase Edge /
Cloudflare Workers / Bun / Next edge).

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

| Peer               | Why                                                                                    | Optional?                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `@solvapay/server` | Runtime `*Core` helpers + `SolvaPay`, `PaywallError`, `PaywallStructuredContent` types | Yes — only consumed by `buildSolvaPayDescriptors`, `buildPayableHandler`, `paywallToolResult` |
| `zod`              | Descriptor `inputSchema` shape                                                         | Yes — descriptor consumers decide whether to use zod                                          |

## See also

- [`@solvapay/mcp`](../mcp) — official `@modelcontextprotocol/sdk` + `ext-apps` adapter (`createSolvaPayMcpServer`)
- [`@solvapay/mcp/express`](../mcp/src/express) — Node `(req, res, next)` OAuth middleware stack
- [`@solvapay/mcp/fetch`](../mcp/src/fetch) — fetch-first OAuth handlers + turnkey `createSolvaPayMcpFetchHandler` / `createSolvaPayMcpFetch`
- [`@solvapay/server`](../server) — core SDK (paywall, webhooks, `*Core` helpers)
- [`@solvapay/react/mcp`](../react) — React provider + views for the MCP App UI shell
