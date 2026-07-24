# SolvaPay SDK

[![npm version](https://img.shields.io/npm/v/@solvapay/server.svg)](https://www.npmjs.com/package/@solvapay/server)
[![preview](https://img.shields.io/npm/v/@solvapay/server/preview?label=preview)](https://www.npmjs.com/package/@solvapay/server?activeTab=versions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TypeScript SDK for monetizing APIs, AI agents, and MCP servers — paywall protection, checkout UI, and purchase management.

**Configure** with `npx solvapay init` or `npm create solvapay -- --type mcp` · **Integrate** with Express, Next.js, Supabase Edge, or MCP · **Monetize** with paywalls, checkout, and usage metering.

## Quickstart

### Existing project — auth + env

```bash
npx solvapay init
```

### New paid MCP app (recommended)

```bash
npm create solvapay@latest my-mcp-app -- --type mcp
```

### Try an example (no API key)

```bash
git clone https://github.com/solvapay/solvapay-sdk
cd solvapay-sdk && pnpm install && pnpm build
cd examples/typescript/express-basic && pnpm dev   # stub mode — no API key needed
```

### Skills for coding agents

> **Using Claude Code, Codex, Cursor, or other AI coding agents?**
>
> Install the [SolvaPay skills](https://docs.solvapay.com/guides/use-agent-skill) and describe what you want to build — the router picks the right workflow (MCP app, SDK integration, checkout, etc.).
>
> ```bash
> npx skills add solvapay/skills
> ```

## Integration paths

| Path | Entry | Packages | Example | Docs |
| --- | --- | --- | --- | --- |
| Express API | `npx solvapay init` | `@solvapay/server` | [express-basic](./examples/typescript/express-basic) | [Express](https://docs.solvapay.com/sdks/typescript/guides/express) |
| Next.js checkout | `npx solvapay init` | `@solvapay/next` + `@solvapay/react` | [checkout-demo](./examples/typescript/checkout-demo) | [Next.js](https://docs.solvapay.com/sdks/typescript/guides/nextjs), [React](https://docs.solvapay.com/sdks/typescript/guides/react) |
| Hosted checkout | `npx solvapay init` | `@solvapay/next` | [hosted-checkout-demo](./examples/typescript/hosted-checkout-demo) | [Purchase management](https://docs.solvapay.com/sdks/typescript/guides/purchase-management) |
| Supabase Edge | `npx solvapay init` | `@solvapay/server/fetch` + `@solvapay/react` | [supabase-edge](./examples/typescript/supabase-edge) | [Supabase Edge](https://docs.solvapay.com/sdks/typescript/guides/supabase-edge) |
| MCP app (server + UI) | **`npm create solvapay@latest <name> -- --type mcp`** | `@solvapay/mcp` + `@solvapay/react/mcp` + `@solvapay/server` | scaffold template | [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp), [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app) |
| MCP App UI (advanced) | manual on existing server | `@solvapay/mcp` + `@solvapay/react/mcp` | [mcp-checkout-app](./examples/typescript/mcp-checkout-app) | [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app) |
| Existing MCP server | `npx solvapay init` | `@solvapay/server` + `@solvapay/mcp-core` | [mcp-oauth-bridge](./examples/typescript/mcp-oauth-bridge) | [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp) |

## Packages

The SDK ships **10 published npm packages**:

| Package | Purpose |
| --- | --- |
| [`solvapay`](./packages/cli) | CLI — `npx solvapay init` for existing repos |
| [`create-solvapay`](./packages/create-solvapay) | Scaffold new MCP apps |
| [`@solvapay/server`](./packages/server) | Paywall, API client, webhooks (Node + Edge) |
| [`@solvapay/react`](./packages/react) | Headless checkout UI and hooks |
| [`@solvapay/next`](./packages/next) | Next.js API route helpers |
| [`@solvapay/mcp`](./packages/mcp) | Official MCP SDK adapter |
| [`@solvapay/mcp-core`](./packages/mcp-core) | Framework-neutral MCP contracts |
| [`@solvapay/auth`](./packages/auth) | Auth adapters |
| [`@solvapay/react-supabase`](./packages/react-supabase) | Supabase auth for React |
| [`@solvapay/core`](./packages/core) | Shared types and utilities |

Each package README is the npm landing page for that surface. See [`docs/contributing/architecture.md`](./docs/contributing/architecture.md) for contributor architecture notes.

## Usage at a glance

**Server paywall** — see [`@solvapay/server`](./packages/server/README.md):

```typescript
import { createSolvaPay } from '@solvapay/server'

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })
const payable = solvaPay.payable({ product: 'prd_YOUR_PRODUCT' })

app.post('/tasks', payable.http(handler))       // Express
export const POST = payable.next(handler)      // Next.js App Router
```

**Client checkout** — see [`@solvapay/react`](./packages/react/README.md):

```tsx
import { SolvaPayProvider, CheckoutLayout } from '@solvapay/react'

<SolvaPayProvider>
  <CheckoutLayout productRef="prd_myapi" prefillCustomer={{ email }} />
</SolvaPayProvider>
```

**Next.js API routes** — see [`@solvapay/next`](./packages/next/README.md) (not duplicated here).

**Supabase Edge** — one-liner handlers via [`@solvapay/server/fetch`](./packages/server/README.md#web-standards-runtimes--solvapayserverfetch-subpath).

## Examples

| Example | Stack |
| --- | --- |
| [express-basic](./examples/typescript/express-basic) | Express paywall + stub mode |
| [checkout-demo](./examples/typescript/checkout-demo) | Next.js checkout + Supabase |
| [hosted-checkout-demo](./examples/typescript/hosted-checkout-demo) | Redirect checkout + portal |
| [supabase-edge](./examples/typescript/supabase-edge) | Edge Functions one-liners |
| [mcp-oauth-bridge](./examples/typescript/mcp-oauth-bridge) | MCP OAuth + paywall |

See [`examples/README.md`](./examples/README.md) for setup instructions.

## Documentation

- **[TypeScript SDK](https://docs.solvapay.com/sdks/typescript/intro)** — integration guides and API reference
- **[Architecture](./docs/contributing/architecture.md)** — package design (contributors)
- **[Contributing](./CONTRIBUTING.md)** — development workflow

## Development

```bash
pnpm install
pnpm build
pnpm test
```

The monorepo uses [Changesets](https://github.com/changesets/changesets) for per-package versioning. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for branching, preview publishes, and release workflow.

## Security

API keys never reach the browser. Payment flows run through backend routes. Webhook signature verification is included.

**Found a vulnerability?** See [SECURITY.md](./SECURITY.md).

## License

MIT — see [LICENSE.md](./LICENSE.md).

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Email**: contact@solvapay.com
- **Docs**: [docs.solvapay.com](https://docs.solvapay.com)
