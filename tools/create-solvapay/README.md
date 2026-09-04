# create-solvapay

[![npm version](https://img.shields.io/npm/v/create-solvapay.svg)](https://www.npmjs.com/package/create-solvapay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The recommended way to create **paid MCP apps** in TypeScript, Python, Ruby, Go, or Rust. TypeScript scaffolds a Cloudflare Workers app (`@solvapay/mcp` + `@solvapay/react/mcp`). Other languages scaffold an HTTP `/mcp` server from the matching official SDK.

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
npm create solvapay@latest my-mcp-app -- --type mcp --no-openapi --language python
```

`--language` is `ts` (default in non-interactive mode), `python`, `ruby`, `go`, or `rust`. Non-TypeScript languages are preview until those SDKs publish to production registries. OpenAPI codegen is TypeScript-only.

### Skills for coding agents

> **Already in an agent session?** Run `npx skills add solvapay/skills` and ask to create a paid MCP app — the agent routes to `create-mcp-app` and runs the scaffold for you.
>
> ```bash
> npx skills add solvapay/skills
> ```
>
> See [Use agent skills](https://docs.solvapay.com/guides/use-agent-skill) for setup.

## What the scaffold includes

TypeScript (`--language ts`) is a Cloudflare Worker:

- **Worker transport** — fetch-first MCP endpoint via `@solvapay/mcp/fetch`
- **Paywall** — `registerPayable` tools wired to your SolvaPay product
- **Widget UI** — `@solvapay/react/mcp` checkout, account, and topup views
- **OAuth bridge** — discovery metadata and bearer-token customer identity
- **Deploy scripts** — `npm run deploy` with wrangler + secret upload

Python, Ruby, Go, and Rust (`--language python|ruby|go|rust`, preview) scaffold an HTTP `/mcp` server on port 3030 with a placeholder paid tool, `.env.example`, and `scripts/http.sh` / `scripts/tunnel.sh`.

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

| Flag                | Description                                                   |
| ------------------- | ------------------------------------------------------------- |
| `--type <kind>`     | Project type (`mcp`, `next-auth0`). Required in non-interactive mode. |
| `-l, --language`    | `ts`, `python`, `ruby`, `go`, `rust` (prompt in TTY; default `ts`) |
| `-y`, `--yes`       | Non-interactive: accept all defaults                          |
| `--product <ref>`   | Pre-fill `SOLVAPAY_PRODUCT_REF` (skip the picker)             |
| `--non-interactive` | Alias for `--yes`; fail fast on missing prompt input          |
| `--skip-install`    | Skip post-scaffold `npm install`                              |
| `--skip-init`       | Skip post-scaffold `solvapay init` (no browser OAuth)         |
| `--dev`             | Target api-dev.solvapay.com (internal testing only)           |
| `--list-types`      | List available project types and exit                         |

**MCP (`--type mcp`)**

| Flag                    | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `--openapi <url\|path>` | OpenAPI / Swagger spec — implies from-openapi mode                |
| `--no-openapi`          | From-scratch mode with a placeholder paid tool                    |
| `--tool-name <camel>`   | Placeholder tool name in from-scratch mode (default: `helloTool`) |
| `--module <path>`       | Go module path (default: `github.com/example/<project-name>`)     |

Run `npm create solvapay my-app -- --type mcp --help` for MCP-specific help.

## Integration paths

| Path                      | Entry                                                 | Packages                                                     | Example                                                                                                             | Docs                                                                                                                                |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Express API               | `npx solvapay init`                                   | `@solvapay/server`                                           | [express-basic](https://github.com/solvapay/solvapay-sdk/tree/main/examples/typescript/express-basic)               | [Express](https://docs.solvapay.com/sdks/typescript/guides/express)                                                                 |
| Next.js checkout          | `npx solvapay init`                                   | `@solvapay/next` + `@solvapay/react`                         | [checkout-demo](https://github.com/solvapay/solvapay-sdk/tree/main/examples/typescript/checkout-demo)               | [Next.js](https://docs.solvapay.com/sdks/typescript/guides/nextjs), [React](https://docs.solvapay.com/sdks/typescript/guides/react) |
| Hosted checkout           | `npx solvapay init`                                   | `@solvapay/next`                                             | [hosted-checkout-demo](https://github.com/solvapay/solvapay-sdk/tree/main/examples/typescript/hosted-checkout-demo) | [Purchase management](https://docs.solvapay.com/sdks/typescript/guides/purchase-management)                                         |
| Supabase Edge             | `npx solvapay init`                                   | `@solvapay/server/fetch` + `@solvapay/react`                 | [supabase-edge](https://github.com/solvapay/solvapay-sdk/tree/main/examples/typescript/supabase-edge)               | [Supabase Edge](https://docs.solvapay.com/sdks/typescript/guides/supabase-edge)                                                     |
| **MCP app (server + UI)** | **`npm create solvapay@latest <name> -- --type mcp`** | `@solvapay/mcp` + `@solvapay/react/mcp` + `@solvapay/server` | scaffold template                                                                                                   | [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp), [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)    |
| MCP App UI (advanced)     | manual on existing server                             | `@solvapay/mcp` + `@solvapay/react/mcp`                      | [mcp-checkout-app](https://github.com/solvapay/solvapay-sdk/tree/main/examples/typescript/mcp-checkout-app)         | [MCP app](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)                                                                 |
| Existing MCP server       | `npx solvapay init`                                   | `@solvapay/server` + `@solvapay/mcp-core`                    | [mcp-oauth-bridge](https://github.com/solvapay/solvapay-sdk/tree/main/examples/typescript/mcp-oauth-bridge)         | [MCP](https://docs.solvapay.com/sdks/typescript/guides/mcp)                                                                         |

## Documentation

- [MCP app guide](https://docs.solvapay.com/sdks/typescript/guides/mcp-app)
- [TypeScript SDK intro](https://docs.solvapay.com/sdks/typescript/intro)

## Support

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Security**: [Security Policy](https://github.com/solvapay/solvapay-sdk/blob/main/SECURITY.md)
- **Docs**: [docs.solvapay.com](https://docs.solvapay.com)
