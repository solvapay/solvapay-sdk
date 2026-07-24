# @solvapay/mcp

[![npm version](https://img.shields.io/npm/v/@solvapay/mcp.svg)](https://www.npmjs.com/package/@solvapay/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official `@modelcontextprotocol/sdk` + `@modelcontextprotocol/ext-apps` adapter for SolvaPay MCP servers.

**When to use this package:** add paywalled tools and SolvaPay transport tools to an MCP server. For a **new** app, prefer the scaffolder first:

```bash
npm create solvapay@latest my-mcp-app -- --type mcp
```

Manual `createSolvaPayMcpServer` wiring is the **advanced path** for existing servers or custom frameworks.

Guides: [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp) · [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)

## Install

```bash
pnpm add @solvapay/mcp @solvapay/server \
  @modelcontextprotocol/sdk @modelcontextprotocol/ext-apps zod
```

## Quickstart (advanced)

```typescript
import { createSolvaPayMcpServer, registerPayableTool } from '@solvapay/mcp'
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
      handler: async ({ prompt }, ctx) => ctx.respond({ videoUrl: await generate(prompt) }),
    })
  },
})
```

One call wires transport tools, UI resource (Stripe CSP baseline), and your payable tools.

## Subpath exports

| Import                  | Use when                                                        |
| ----------------------- | --------------------------------------------------------------- |
| `@solvapay/mcp`         | `createSolvaPayMcpServer`, `registerPayableTool`                |
| `@solvapay/mcp/express` | Node `(req, res, next)` OAuth middleware                        |
| `@solvapay/mcp/fetch`   | Edge `createSolvaPayMcpFetchHandler` / `createSolvaPayMcpFetch` |

Framework-neutral contracts live in [`@solvapay/mcp-core`](../mcp-core).

## Handler contract

Handlers receive `args` and a `ResponseContext`. Return `ctx.respond(data, options?)`. Paywall gates are text-only narrations — the widget iframe opens only on deliberate intent tools (`upgrade`, `manage_account`, `topup`).

See [`ctx.respond()` V1 spec](../../docs/spec/ctx-respond-v1.md).

## See also

- [`create-solvapay`](../create-solvapay) — scaffold MCP apps (recommended for greenfield)
- [`@solvapay/mcp-core`](../mcp-core) — descriptors for custom adapters
- [`@solvapay/react/mcp`](../react) — MCP App UI components
- [`@solvapay/server`](../server) — core paywall runtime
- [MCP app example](../../examples/typescript/mcp-checkout-app)

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Docs**: [docs.solvapay.com/sdks/typescript/guides/mcp](https://docs.solvapay.com/sdks/typescript/guides/mcp)
