# MCP time app example

This example shows an MCP App server with:

- an app tool (`get-current-time`) linked to a UI resource through `_meta.ui.resourceUri`
- SolvaPay paywall support for business tools via `payable.mcp()`
- SolvaPay virtual self-service tools (`get_user_info`, `upgrade`, `manage_account`)
- OAuth metadata and auth middleware via `createMcpOAuthBridge()`

The UI remains the same as the original time app example (interactive view with a refresh button).

## Text-only hosts

MCP Apps is optional. Hosts that never mount `ui://` (Claude Code, CLI
clients, n8n) still have to learn the current limit, recover, and find
user info from `content[0].text` alone. Official MCP Apps / 2026-07-28
tools guidance: `content` is the model and text-only-host lane;
`structuredContent` is for the widget and is often hidden from the
model when `content` is present.

- A paywalled `get-current-time` call past the plan limit returns a
  **text-only gate** — no iframe. The first text block names the limit,
  the reason, and one recovery tool (`upgrade` / `topup` /
  `activate_plan`) plus a https URL.
- `manage_account` is the text-host account page (plan, remaining,
  payment method).
- `docs://solvapay/overview.md` (when registered by the factory) is
  how a text host discovers app capabilities.

Do not write `"shown in the panel."` as the first text block. Full
contract:
[`docs/contributing/mcp-apps-host-contract.md`](../../docs/contributing/mcp-apps-host-contract.md).

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

- `SOLVAPAY_API_BASE_URL` — against a local platform stack use
  `http://localhost:3010` (see [`../.env.platform-local.example`](../.env.platform-local.example))
- `MCP_PORT` — use `3030+` locally so you don't collide with platform services
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
