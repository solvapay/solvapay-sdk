# @solvapay/mcp-sdk

Official `@modelcontextprotocol/sdk` + `@modelcontextprotocol/ext-apps`
adapter for the SolvaPay MCP toolbox.

This is the only SolvaPay package that imports `@modelcontextprotocol/*`.
Framework-neutral contracts (tool names, descriptors, paywall meta,
OAuth bridge, JWT helpers) live in [`@solvapay/mcp`](../mcp) so
alternative adapters (`mcp-lite`, `fastmcp-node`, raw JSON-RPC) can
reuse the same contract.

## Install

```bash
pnpm add @solvapay/mcp-sdk @solvapay/server \
  @modelcontextprotocol/sdk @modelcontextprotocol/ext-apps zod
```

## Importing

Everything you need for a paywalled tool lives in this package:

```ts
import {
  createSolvaPayMcpServer,
  registerPayableTool,
  type ResponseContext,
  type NudgeSpec,
} from '@solvapay/mcp-sdk'
```

Reach into `@solvapay/mcp` directly only if you're writing a framework
adapter (`mcp-lite`, `fastmcp`, raw JSON-RPC).

## Quick start

```ts
import { createSolvaPayMcpServer } from '@solvapay/mcp-sdk'
import { createSolvaPay } from '@solvapay/server'
import { z } from 'zod'

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY! })

const server = createSolvaPayMcpServer({
  solvaPay,
  productRef: 'prd_video',
  resourceUri: 'ui://my-app/mcp-app.html',
  htmlPath: './dist/mcp-app.html',
  publicBaseUrl: 'https://my-app.example.com',
  additionalTools: ({ registerPayable }) => {
    registerPayable('create_video', {
      schema: { prompt: z.string() },
      description: 'Generate a short video from a text prompt.',
      handler: async ({ prompt }, ctx) => {
        const videoUrl = await generateVideo(prompt)
        return ctx.respond({ videoUrl })
      },
    })
  },
})
```

One call wires the full SolvaPay transport surface (`check_purchase`,
`create_payment_intent`, `process_payment`, `open_checkout`, etc.), the
UI resource with the Stripe CSP baseline, and any integrator-defined
tools via `additionalTools`.

## Handler contract

`registerPayable` handlers receive parsed `args` (inferred from
`schema` when provided) and a `ResponseContext`. They must return the
branded envelope produced by `ctx.respond(data, options?)`.

```ts
handler: async ({ prompt }, ctx) => {
  const video = await generate(prompt)
  // Attach an upsell nudge when the customer is low on credits.
  if (ctx.customer.balance < 500) {
    return ctx.respond({ videoUrl: video.url }, {
      nudge: { kind: 'low-balance', message: 'Running low on credits' },
    })
  }
  return ctx.respond({ videoUrl: video.url })
}
```

The [`ctx.respond()` V1 spec](../../docs/spec/ctx-respond-v1.md) has the
full surface. The TL;DR:

- `ctx.customer` — cached customer snapshot (≤10s stale). Read
  `balance` / `remaining` / `plan` to branch on usage; call
  `ctx.customer.fresh()` for a fresh fetch when staleness matters.
- `ctx.respond(data, options?)` — returns a branded envelope. `options`
  carries `text` (override `content[0].text`), `nudge` (inline upsell
  strip), and the reserved `units` (V1.1 variable-unit billing — V1
  silently ignores).
- `ctx.gate(reason?)` — throws a `PaywallError` to force the paywall
  response. Sugar over `throw new PaywallError(...)`.
- `ctx.emit(block)` / `ctx.progress(...)` / `ctx.signal` — reserved
  surface. V1 queues (emit) or no-ops (progress / signal); V1.1 wires
  them to SSE and transport cancellation without code changes.

## What's in the box

| Export | Use when |
|---|---|
| `createSolvaPayMcpServer(opts)` | You want the batteries-included `McpServer` with every SolvaPay tool registered |
| `registerPayableTool(server, name, opts)` | You want to add a paywall-protected tool to an existing `McpServer`. `_meta.ui` is attached per-result on paywall and nudge responses only, so the iframe opens only when there's something to show. |

## Peer dependencies

| Peer | Why |
|---|---|
| `@modelcontextprotocol/sdk` | The `McpServer` this package builds and returns |
| `@modelcontextprotocol/ext-apps` | `registerAppTool`, `registerAppResource`, the `RESOURCE_MIME_TYPE` constant |
| `@solvapay/mcp` | Neutral contracts and descriptor builder |
| `@solvapay/server` | `SolvaPay` factory + `PaywallError` runtime |
| `zod` | Tool `inputSchema` shape (required by the ext-apps helpers) |

## Want to adapt another framework?

Use [`@solvapay/mcp`](../mcp) directly. `buildSolvaPayDescriptors`
returns a framework-neutral bundle; map it onto your framework's
`registerTool` / `registerResource` API in ~60 lines. This package is
itself that mapper for the official SDK.
