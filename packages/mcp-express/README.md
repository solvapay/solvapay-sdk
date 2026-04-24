# @solvapay/mcp-express

Node `(req, res, next)` OAuth bridge middleware for the SolvaPay MCP
server. Pair with [`@solvapay/mcp`](../mcp) (MCP server factory) and
[`@solvapay/mcp-core`](../mcp-core) (framework-neutral contracts).

For Web-standards runtimes (Deno / Supabase Edge / Cloudflare Workers /
Bun / Next edge / Vercel Functions) use
[`@solvapay/mcp-fetch`](../mcp-fetch) instead.

## Install

```bash
pnpm add @solvapay/mcp-express @solvapay/mcp @solvapay/mcp-core
```

## Usage

```ts
import express from 'express'
import { createMcpOAuthBridge } from '@solvapay/mcp-express'

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(
  ...createMcpOAuthBridge({
    publicBaseUrl: 'https://my-mcp.example.com',
    apiBaseUrl: 'https://api.solvapay.com',
    productRef: 'prd_video',
    mcpPath: '/mcp',
  }),
)
```

The middleware stack mounts:

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `GET /.well-known/openid-configuration` (returns 404 — SolvaPay is an OAuth 2.0 AS, not an OIDC Provider)
- `POST /oauth/register` → proxies `/v1/customer/auth/register?product_ref=…`
- `GET /oauth/authorize` → 302 to `/v1/customer/auth/authorize`
- `POST /oauth/token` → proxies `/v1/customer/auth/token` (RFC 6749 §5.2 error normalisation)
- `POST /oauth/revoke` → proxies `/v1/customer/auth/revoke`
- `POST /mcp` auth guard → 401 + `WWW-Authenticate: Bearer resource_metadata=…`

Native-scheme CORS (`cursor://…`, `vscode://…`, `vscode-webview://…`,
`claude://…`) is mirrored so DCR + MCP calls work from desktop clients.

## See also

- [`@solvapay/mcp-fetch`](../mcp-fetch) — the Web-standards sibling for Deno / Edge / Workers
- [`@solvapay/mcp`](../mcp) — `createSolvaPayMcpServer` factory
- [`@solvapay/mcp-core`](../mcp-core) — `getOAuthAuthorizationServerResponse`, JWT helpers
