# solvapay

[![npm version](https://img.shields.io/npm/v/solvapay.svg)](https://www.npmjs.com/package/solvapay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

SolvaPay CLI — authenticate, configure env, and bootstrap SDK integration in an existing repo.

**Configure** with `npx solvapay init` · **Integrate** with `@solvapay/server`, `@solvapay/next`, or `@solvapay/mcp` · **Monetize** with paywalls, checkout UI, and usage metering.

## Quickstart

```bash
# Auth + env in an existing project
npx solvapay init

# Skip browser confirmation prompt
npx solvapay init --yes

# Target the SolvaPay dev backend (internal testing only)
npx solvapay init --dev
```

After init, protect an endpoint:

```typescript
import { createSolvaPay } from '@solvapay/server'

const solvaPay = createSolvaPay({ apiKey: process.env.SOLVAPAY_SECRET_KEY })
const payable = solvaPay.payable({ product: process.env.SOLVAPAY_PRODUCT_REF! })

app.post(
  '/tasks',
  payable.http(async args => ({ id: 'task_1', ...args })),
)
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

| Path                  | Entry                                                 | Packages                                                     | Example                                                                                                  | Docs                                                                                                                                |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Express API           | `npx solvapay init`                                   | `@solvapay/server`                                           | [express-basic](https://github.com/solvapay/solvapay-sdk/tree/main/examples/express-basic)               | [Express](https://docs.solvapay.com/sdks/typescript/guides/express)                                                                 |
| Next.js checkout      | `npx solvapay init`                                   | `@solvapay/next` + `@solvapay/react`                         | [checkout-demo](https://github.com/solvapay/solvapay-sdk/tree/main/examples/checkout-demo)               | [Next.js](https://docs.solvapay.com/sdks/typescript/guides/nextjs), [React](https://docs.solvapay.com/sdks/typescript/guides/react) |
| Hosted checkout       | `npx solvapay init`                                   | `@solvapay/next`                                             | [hosted-checkout-demo](https://github.com/solvapay/solvapay-sdk/tree/main/examples/hosted-checkout-demo) | [Purchase management](https://docs.solvapay.com/sdks/typescript/guides/purchase-management)                                         |
| Supabase Edge         | `npx solvapay init`                                   | `@solvapay/server/fetch` + `@solvapay/react`                 | [supabase-edge](https://github.com/solvapay/solvapay-sdk/tree/main/examples/supabase-edge)               | [Supabase Edge](https://docs.solvapay.com/sdks/typescript/guides/supabase-edge)                                                     |
| MCP app (server + UI) | **`npm create solvapay@latest <name> -- --type mcp`** | `@solvapay/mcp` + `@solvapay/react/mcp` + `@solvapay/server` | scaffold template                                                                                        | [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp), [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)    |
| MCP App UI (advanced) | manual on existing server                             | `@solvapay/mcp` + `@solvapay/react/mcp`                      | [mcp-checkout-app](https://github.com/solvapay/solvapay-sdk/tree/main/examples/mcp-checkout-app)         | [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)                                                                 |
| Existing MCP server   | `npx solvapay init`                                   | `@solvapay/server` + `@solvapay/mcp-core`                    | [mcp-oauth-bridge](https://github.com/solvapay/solvapay-sdk/tree/main/examples/mcp-oauth-bridge)         | [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp)                                                                         |

## Create MCP apps

For a **new** paid MCP app (Worker transport, paywall, checkout/account/topup UI, deploy scripts), use the scaffolder — not `solvapay init`:

```bash
npm create solvapay@latest my-mcp-app -- --type mcp
# equivalent: npx create-solvapay@latest my-mcp-app -- --type mcp
```

See [`create-solvapay` on npm](https://www.npmjs.com/package/create-solvapay) for OpenAPI and from-scratch variants. Use `npx solvapay init` only to add SolvaPay to a repo that already exists.

## Packages

| Package                    | npm                                                                                | Purpose                                   |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| `solvapay`                 | [solvapay](https://www.npmjs.com/package/solvapay)                                 | CLI — auth + env bootstrap (this package) |
| `create-solvapay`          | [create-solvapay](https://www.npmjs.com/package/create-solvapay)                   | Scaffold new MCP apps                     |
| `@solvapay/server`         | [@solvapay/server](https://www.npmjs.com/package/@solvapay/server)                 | Paywall, API client, webhooks             |
| `@solvapay/react`          | [@solvapay/react](https://www.npmjs.com/package/@solvapay/react)                   | Checkout UI and hooks                     |
| `@solvapay/next`           | [@solvapay/next](https://www.npmjs.com/package/@solvapay/next)                     | Next.js API route helpers                 |
| `@solvapay/mcp`            | [@solvapay/mcp](https://www.npmjs.com/package/@solvapay/mcp)                       | Official MCP SDK adapter                  |
| `@solvapay/mcp-core`       | [@solvapay/mcp-core](https://www.npmjs.com/package/@solvapay/mcp-core)             | Framework-neutral MCP contracts           |
| `@solvapay/auth`           | [@solvapay/auth](https://www.npmjs.com/package/@solvapay/auth)                     | Auth adapters                             |
| `@solvapay/react-supabase` | [@solvapay/react-supabase](https://www.npmjs.com/package/@solvapay/react-supabase) | Supabase auth for React                   |
| `@solvapay/core`           | [@solvapay/core](https://www.npmjs.com/package/@solvapay/core)                     | Shared types and utilities                |

## Examples

| Example                                                                                                  | Stack         | Highlights                                  |
| -------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------- |
| [express-basic](https://github.com/solvapay/solvapay-sdk/tree/main/examples/express-basic)               | Express       | Paywall + stub mode                         |
| [checkout-demo](https://github.com/solvapay/solvapay-sdk/tree/main/examples/checkout-demo)               | Next.js       | Full checkout + Supabase auth               |
| [hosted-checkout-demo](https://github.com/solvapay/solvapay-sdk/tree/main/examples/hosted-checkout-demo) | Next.js       | Redirect checkout + portal                  |
| [supabase-edge](https://github.com/solvapay/solvapay-sdk/tree/main/examples/supabase-edge)               | Supabase Edge | One-liner `@solvapay/server/fetch` handlers |
| [mcp-oauth-bridge](https://github.com/solvapay/solvapay-sdk/tree/main/examples/mcp-oauth-bridge)         | Node MCP      | OAuth bridge + `payable.mcp()`              |

## Flags

| Flag          | Description                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-y`, `--yes` | Auto-create `package.json` and skip the browser confirmation prompt.                                                                                                           |
| `--dev`       | Target the SolvaPay dev backend (`https://api-dev.solvapay.com`). Persists `SOLVAPAY_API_BASE_URL` to `.env`. Internal testing only — production keys are rejected by api-dev. |

## What `solvapay init` does

- Checks for `package.json` (and can create one if missing)
- Shows auth URL and asks you to press Enter before opening browser authentication
- Writes `SOLVAPAY_SECRET_KEY` to `.env` (with overwrite confirmation)
- Ensures `.env` is ignored in `.gitignore`
- Installs `@solvapay/server` and `@solvapay/core`
- Verifies the key and prints a setup summary

## Product configuration

After the secret key is verified, `solvapay init` configures `SOLVAPAY_PRODUCT_REF`:

- If `.env` already has a real product ref, verifies it and asks whether to keep it (`[Y/n]`).
- Otherwise lists products on your account (newest first, up to 10) and prompts you to pick one.
- With a single product, confirms with `Use "<name>" (prd_xxx)? [Y/n]`.
- With multiple products, shows a numbered list and accepts `[1-N]` (default `1`).
- With `--yes` or in non-interactive mode, auto-picks the newest product.
- With zero products, warns and points to [SolvaPay Console → Products](https://app.solvapay.com/products) — init still completes.

The chosen ref is written to `.env`. A scaffold placeholder (`__SOLVAPAY_PRODUCT_REF__`) or a missing ref triggers the picker automatically.

## Documentation

Full SDK reference: [docs.solvapay.com/sdks/typescript](https://docs.solvapay.com/sdks/typescript/intro)

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Security**: [Security Policy](https://github.com/solvapay/solvapay-sdk/blob/main/SECURITY.md)
- **Docs**: [docs.solvapay.com](https://docs.solvapay.com)
