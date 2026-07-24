# MCP time app example

This example shows an MCP App server with:

- an app tool (`get-current-time`) linked to a UI resource through `_meta.ui.resourceUri`
- SolvaPay paywall support for business tools via `payable.mcp()`
- SolvaPay virtual self-service tools (`get_user_info`, `upgrade`, `manage_account`)
- OAuth metadata and auth middleware via `createMcpOAuthBridge()`

The UI remains the same as the original time app example (interactive view with a refresh button).

## Environment variables

Copy `.env.example` to `.env` and set values:

```bash
cp .env.example .env
```

Required for paywall-enabled mode:

- `SOLVAPAY_SECRET_KEY`
- `SOLVAPAY_PRODUCT_REF`
- `MCP_PUBLIC_BASE_URL`

Optional:

- `SOLVAPAY_API_BASE_URL` (defaults to `http://localhost:3000`)
- `MCP_PORT` (defaults to `3005`)
- `MCP_HOST` (defaults to `localhost`)
- `PAYWALL_ENABLED` (`true` by default, set to `false` to disable auth/paywall)

## Run the example

```bash
pnpm install
pnpm --filter @example/mcp-time-app build
pnpm --filter @example/mcp-time-app serve
```

For local development with watch mode:

```bash
pnpm --filter @example/mcp-time-app dev
```

## Endpoints

- `GET /health`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`
