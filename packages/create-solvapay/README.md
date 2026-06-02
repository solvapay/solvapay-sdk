# create-solvapay

[![npm version](https://img.shields.io/npm/v/create-solvapay.svg)](https://www.npmjs.com/package/create-solvapay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The recommended way to create **paid MCP apps** — Cloudflare Workers transport, `@solvapay/mcp` paywall, `@solvapay/react/mcp` checkout/account/topup UI, and deploy scripts in one step.

## Quickstart

```bash
npm create solvapay@latest my-mcp-app -- --type mcp
# equivalent: npx create-solvapay@latest my-mcp-app -- --type mcp
```

From an OpenAPI spec:

```bash
npm create solvapay@latest my-api-mcp -- --type mcp --openapi ./openapi.yaml
```

From scratch (single placeholder tool):

```bash
npm create solvapay@latest my-mcp-app -- --type mcp --no-openapi
```

### Skills for coding agents

> **Already in an agent session?** Run `npx skills add solvapay/skills` and ask to create a paid MCP app — the agent routes to `create-mcp-app` and runs the scaffold for you.
>
> ```bash
> npx skills add solvapay/skills
> ```
>
> See [Use agent skills](https://docs.solvapay.com/guides/use-agent-skill) for setup.

## What the scaffold includes

- **Worker transport** — fetch-first MCP endpoint via `@solvapay/mcp/fetch`
- **Paywall** — `registerPayable` tools wired to your SolvaPay product
- **Widget UI** — `@solvapay/react/mcp` checkout, account, and topup views
- **OAuth bridge** — discovery metadata and bearer-token customer identity
- **Deploy scripts** — `npm run deploy` with wrangler + secret upload

See the generated project README and [MCP app guide](https://docs.solvapay.com/sdks/typescript/guides/mcp-app) for local dev and go-live steps.

## Post-scaffold

```bash
cd my-mcp-app
npm install          # skipped if you didn't pass --skip-install
npm run dev          # vite watch + wrangler dev on http://localhost:8787
npm run deploy       # Cloudflare Workers deploy
```

`solvapay init` runs automatically after scaffold (unless `--skip-init`) to write `SOLVAPAY_SECRET_KEY` and pick a product. For **existing repos**, use [`npx solvapay init`](https://www.npmjs.com/package/solvapay) instead of this scaffolder.

## Flags

**Common**

| Flag | Description |
| --- | --- |
| `--type <kind>` | Project type (`mcp` today). Required in non-interactive mode. |
| `-y`, `--yes` | Non-interactive: accept all defaults |
| `--product <ref>` | Pre-fill `SOLVAPAY_PRODUCT_REF` (skip the picker) |
| `--non-interactive` | Alias for `--yes`; fail fast on missing prompt input |
| `--skip-install` | Skip post-scaffold `npm install` |
| `--skip-init` | Skip post-scaffold `solvapay init` (no browser OAuth) |
| `--dev` | Target api-dev.solvapay.com (internal testing only) |
| `--list-types` | List available project types and exit |

**MCP (`--type mcp`)**

| Flag | Description |
| --- | --- |
| `--openapi <url\|path>` | OpenAPI / Swagger spec — implies from-openapi mode |
| `--no-openapi` | From-scratch mode with a placeholder paid tool |
| `--tool-name <camel>` | Placeholder tool name in from-scratch mode (default: `helloTool`) |

Run `npm create solvapay my-app -- --type mcp --help` for MCP-specific help.

## Integration paths

| Path | Entry | Packages | Example | Docs |
| --- | --- | --- | --- | --- |
| Express API | `npx solvapay init` | `@solvapay/server` | [express-basic](https://github.com/solvapay/solvapay-sdk/tree/main/examples/express-basic) | [Express](https://docs.solvapay.com/sdks/typescript/guides/express) |
| Next.js checkout | `npx solvapay init` | `@solvapay/next` + `@solvapay/react` | [checkout-demo](https://github.com/solvapay/solvapay-sdk/tree/main/examples/checkout-demo) | [Next.js](https://docs.solvapay.com/sdks/typescript/guides/nextjs), [React](https://docs.solvapay.com/sdks/typescript/guides/react) |
| Hosted checkout | `npx solvapay init` | `@solvapay/next` | [hosted-checkout-demo](https://github.com/solvapay/solvapay-sdk/tree/main/examples/hosted-checkout-demo) | [Purchase management](https://docs.solvapay.com/sdks/typescript/guides/purchase-management) |
| Supabase Edge | `npx solvapay init` | `@solvapay/server/fetch` + `@solvapay/react` | [supabase-edge](https://github.com/solvapay/solvapay-sdk/tree/main/examples/supabase-edge) | [Supabase Edge](https://docs.solvapay.com/sdks/typescript/guides/supabase-edge) |
| **MCP app (server + UI)** | **`npm create solvapay@latest <name> -- --type mcp`** | `@solvapay/mcp` + `@solvapay/react/mcp` + `@solvapay/server` | scaffold template | [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp), [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app) |
| MCP App UI (advanced) | manual on existing server | `@solvapay/mcp` + `@solvapay/react/mcp` | [mcp-checkout-app](https://github.com/solvapay/solvapay-sdk/tree/main/examples/mcp-checkout-app) | [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app) |
| Existing MCP server | `npx solvapay init` | `@solvapay/server` + `@solvapay/mcp-core` | [mcp-oauth-bridge](https://github.com/solvapay/solvapay-sdk/tree/main/examples/mcp-oauth-bridge) | [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp) |

## Documentation

- [MCP app guide](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)
- [TypeScript SDK intro](https://docs.solvapay.com/sdks/typescript/intro)

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Security**: [Security Policy](https://github.com/solvapay/solvapay-sdk/blob/main/SECURITY.md)
- **Docs**: [docs.solvapay.com](https://docs.solvapay.com)
