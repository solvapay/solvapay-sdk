# SolvaPay MCP OAuth Bridge Example

This example demonstrates a **non-hosted** MCP server that:

- serves local `/.well-known/*` discovery endpoints on the MCP origin,
- hosts `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke` on the MCP origin and proxies them to SolvaPay,
- protects MCP tools with `@solvapay/server` via `payable.mcp(...)`.

## Why this pattern exists

For non-hosted MCP origins (localhost/custom domains), backend-hosted discovery cannot always infer
product context from subdomain routing, and RFC 8414 §3.3 requires `issuer` to match the metadata
URL. This bridge makes the MCP origin a fully self-consistent authorization server:

- local discovery metadata has `issuer` = MCP origin and all endpoints under MCP origin,
- the four `/oauth/*` routes proxy to SolvaPay (`/v1/customer/auth/*`), injecting `product_ref` at DCR.

## Endpoints

| Endpoint (on MCP origin)                         | Proxied to                                         |
| ------------------------------------------------ | -------------------------------------------------- |
| `GET /.well-known/oauth-protected-resource`      | local (`authorization_servers: [mcpOrigin]`)       |
| `GET /.well-known/oauth-authorization-server`    | local (`issuer` = MCP origin)                      |
| `POST /oauth/register`                           | `POST /v1/customer/auth/register?product_ref=…`    |
| `GET  /oauth/authorize`                          | `302` → `/v1/customer/auth/authorize`              |
| `POST /oauth/token`                              | `POST /v1/customer/auth/token`                     |
| `POST /oauth/revoke`                             | `POST /v1/customer/auth/revoke`                    |

## Quick start

```bash
cd examples/mcp-oauth-bridge
pnpm install
cp .env.example .env
# Edit .env values
pnpm dev
```

Server default: `http://localhost:3004`

## Required environment variables

- `SOLVAPAY_API_BASE_URL`: backend base URL (for example `http://localhost:3000`) used for OAuth endpoints and SDK metering checks
- `SOLVAPAY_PRODUCT_REF`: product reference used by `payable.mcp(...)` and OAuth DCR (`product_ref`)
- `MCP_PUBLIC_BASE_URL`: local MCP origin exposed to clients
- `OAUTH_REDIRECT_URI`: redirect used in DCR + auth flow
- `SOLVAPAY_SECRET_KEY`: backend API key for SDK metering checks

## Webhook receiver notes (local)

- This example's `pnpm dev` process receives webhooks on `POST /webhooks` and serves MCP on `/mcp`.
- Recommended local bind: `MCP_HOST=0.0.0.0` (default in `.env.example`) with
  `MCP_PUBLIC_BASE_URL=http://localhost:3004`.
- Configure the backend webhook endpoint URL as `http://localhost:3004/webhooks` to avoid loopback
  IPv4/IPv6 mismatches (`127.0.0.1` vs `::1`).
- Set `SOLVAPAY_WEBHOOK_SECRET` to the endpoint signing secret from SolvaPay backend.

## Optional bootstrap setup

You can bootstrap product + plans + MCP mapping in one API call before running the bridge:

```ts
import { createSolvaPay } from '@solvapay/server'

const solvaPay = createSolvaPay({
  apiKey: process.env.SOLVAPAY_SECRET_KEY!,
  apiBaseUrl: process.env.SOLVAPAY_API_BASE_URL,
})

await solvaPay.bootstrapMcpProduct({
  name: 'Bridge Example',
  originUrl: 'https://origin.example.com/mcp',
  plans: [
    { key: 'free', name: 'Free', price: 0, billingCycle: 'monthly', freeUnits: 1000 },
    { key: 'pro', name: 'Pro', price: 20, billingCycle: 'monthly' },
  ],
  defaultPlanKey: 'free',
  tools: [
    { name: 'list_tasks', planKeys: ['free'] },
    { name: 'create_task', planKeys: ['pro'] },
    { name: 'health_check', noPlan: true },
  ],
})
```

`requiresPayment` is derived by the backend from each plan's `price` and `type`.
A free plan can still include `billingCycle` and `freeUnits`.

## End-to-end OAuth flow script

```bash
pnpm oauth:flow
```

Script steps:

1. Fetch `/.well-known/oauth-protected-resource`
2. Fetch `/.well-known/oauth-authorization-server` (served by the bridge, `issuer` = MCP origin)
3. Register client at the bridge's `registration_endpoint` (proxied to SolvaPay with `product_ref`)
4. Build authorize URL (PKCE), you login in browser
5. Paste auth code in terminal
6. Exchange token at the bridge's `token_endpoint` (proxied to SolvaPay)
7. Call MCP `initialize` then `tools/call`

## Auth behavior on `/mcp`

- If bearer token is missing/invalid:
  - returns `401` JSON-RPC error
  - includes `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`
- If token is valid:
  - customer identity is resolved via backend `/v1/customer/auth/userinfo`
  - tool arguments are enriched with auth context
  - `payable.mcp(..., { getCustomerRef })` enforces limits/paywall
