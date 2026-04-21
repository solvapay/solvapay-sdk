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
pnpm add @solvapay/mcp-sdk @solvapay/mcp @solvapay/server \
  @modelcontextprotocol/sdk @modelcontextprotocol/ext-apps zod
```

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
      handler: async ({ prompt }) => ({ videoUrl: await generateVideo(prompt) }),
    })
  },
})
```

One call wires the full SolvaPay transport surface (`check_purchase`,
`create_payment_intent`, `process_payment`, `open_checkout`, etc.), the
UI resource with the Stripe CSP baseline, and any integrator-defined
tools via `additionalTools`.

## What's in the box

| Export | Use when |
|---|---|
| `createSolvaPayMcpServer(opts)` | You want the batteries-included `McpServer` with every SolvaPay tool registered |
| `registerPayableTool(server, name, opts)` | You want to add a paywall-protected tool with auto-attached `_meta.ui` to an existing `McpServer` |

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
