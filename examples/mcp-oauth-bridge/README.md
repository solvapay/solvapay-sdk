# SolvaPay MCP OAuth Bridge Example

This example demonstrates a **non-hosted** MCP server that:

- serves local `/.well-known/*` discovery endpoints,
- delegates OAuth + dynamic client registration to SolvaPay backend,
- protects MCP tools with `@solvapay/server` via `payable.mcp(...)`.

## Why this pattern exists

For non-hosted MCP origins (localhost/custom domains), backend-hosted discovery cannot always infer
product context from subdomain routing. This example acts as a bridge:

- local discovery metadata matches your MCP server origin,
- OAuth endpoints still point to SolvaPay backend.

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

- `SOLVAPAY_OAUTH_BASE_URL`: backend base URL (for example `http://localhost:3000`)
- `SOLVAPAY_PRODUCT_REF`: product reference used by `payable.mcp(...)` and OAuth DCR (`product_ref`)
- `MCP_PUBLIC_BASE_URL`: local MCP origin exposed to clients
- `OAUTH_REDIRECT_URI`: redirect used in DCR + auth flow
- `SOLVAPAY_SECRET_KEY`: backend API key for SDK metering checks
- `SOLVAPAY_API_BASE_URL`: backend API base URL for SDK metering checks

## End-to-end OAuth flow script

```bash
pnpm oauth:flow
```

Script steps:

1. Fetch `/.well-known/oauth-protected-resource`
2. Fetch `/.well-known/oauth-authorization-server`
3. Register client at backend `registration_endpoint`
4. Build authorize URL (PKCE), you login in browser
5. Paste auth code in terminal
6. Exchange token
7. Call MCP `initialize` then `tools/call`

## Auth behavior on `/mcp`

- If bearer token is missing/invalid:
  - returns `401` JSON-RPC error
  - includes `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`
- If token is valid:
  - customer identity is resolved via backend `/v1/oauth/userinfo`
  - tool arguments are enriched with auth context
  - `payable.mcp(..., { getCustomerRef })` enforces limits/paywall
