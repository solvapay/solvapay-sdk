# @solvapay/mcp

Official `@modelcontextprotocol/sdk` + `@modelcontextprotocol/ext-apps`
adapter for the SolvaPay MCP toolbox.

This is the only SolvaPay package that imports `@modelcontextprotocol/*`.
Framework-neutral contracts (tool names, descriptors, paywall meta,
OAuth discovery JSON, JWT helpers) live in
[`@solvapay/mcp-core`](../mcp-core) so alternative adapters
(`fastmcp`, raw JSON-RPC) can reuse the same contract. Runtime-specific
OAuth middleware ships as two subpath exports of this package:

- [`@solvapay/mcp/express`](./src/express) — Node `(req, res, next)`.
- [`@solvapay/mcp/fetch`](./src/fetch) — Web standards `(req: Request) => Promise<Response>` + the turnkey `createSolvaPayMcpFetch` factory for Deno / Supabase Edge / Cloudflare Workers / Bun / Next edge / Vercel Functions.

## Install

```bash
pnpm add @solvapay/mcp @solvapay/server \
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
} from '@solvapay/mcp'
```

Reach into `@solvapay/mcp-core` directly only if you're writing a
framework adapter (`fastmcp`, raw JSON-RPC).

## Quick start

```ts
import { createSolvaPayMcpServer } from '@solvapay/mcp'
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
  // Append a text-only nudge when the customer is low on credits.
  // The nudge message is appended to `content[0].text` as a plain
  // suffix — no widget iframe, no `structuredContent` switch. Point
  // the user at the recovery intent tool by name.
  if (ctx.customer.balance < 500) {
    return ctx.respond({ videoUrl: video.url }, {
      nudge: {
        kind: 'low-balance',
        message: 'Running low on credits — call the `topup` tool to add more.',
      },
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
  carries `text` (override `content[0].text`), `nudge` (the nudge
  message is appended to `content[0].text` as a plain-text suffix —
  no widget surface, no `structuredContent` switch), and the reserved
  `units` (V1.1 variable-unit billing — V1 silently ignores).
- `ctx.gate(reason?)` — stops handler execution and routes a paywall
  response through the adapter's `formatGate` channel. Rare — the
  SDK normally fires the paywall automatically via `payable().mcp()`
  pre-check.
- `ctx.emit(block)` / `ctx.progress(...)` / `ctx.signal` — reserved
  surface. V1 queues (emit) or no-ops (progress / signal); V1.1 wires
  them to SSE and transport cancellation without code changes.

## How paywalls work

Paywall responses from `registerPayable` tools are **text-only**:

- `isError: false`, so hosts don't short-circuit on the error path.
- `structuredContent = gate` for programmatic consumers.
- `content[0].text` carries a state-engine-generated narration that
  names the recovery intent tool (`upgrade` for no active plan,
  `topup` for usage-based zero-balance, `activate_plan` for pending
  activation) and inlines `gate.checkoutUrl` for terminal-first
  hosts (Claude Code, CLI MCP clients).

The LLM reads that narration, tells the user, and either (a) the
user clicks the inline URL and completes checkout in the browser, or
(b) the LLM calls the named intent tool which mounts the SolvaPay
widget on `McpCheckoutView` / `McpTopupView`. Only those three
intent tools advertise `_meta.ui.resourceUri` — merchant payable
tools don't, so no uninvited iframe opens on a silent success.

## What's in the box

| Export | Use when |
|---|---|
| `createSolvaPayMcpServer(opts)` | You want the batteries-included `McpServer` with every SolvaPay tool registered |
| `registerPayableTool(server, name, opts)` | You want to add a paywall-protected tool to an existing `McpServer`. Paywall / nudge responses are text-only narrations; the widget iframe stays reserved for the three intent tools. |

## Peer dependencies

| Peer | Why |
|---|---|
| `@modelcontextprotocol/sdk` | The `McpServer` this package builds and returns |
| `@modelcontextprotocol/ext-apps` | `registerAppTool`, `registerAppResource`, the `RESOURCE_MIME_TYPE` constant |
| `@solvapay/mcp-core` | Neutral contracts and descriptor builder |
| `@solvapay/server` | `SolvaPay` factory + `PaywallError` runtime |
| `zod` | Tool `inputSchema` shape (required by the ext-apps helpers) |

## Want to adapt another framework?

Use [`@solvapay/mcp-core`](../mcp-core) directly. `buildSolvaPayDescriptors`
returns a framework-neutral bundle; map it onto your framework's
`registerTool` / `registerResource` API in ~60 lines. This package is
itself that mapper for the official SDK.
