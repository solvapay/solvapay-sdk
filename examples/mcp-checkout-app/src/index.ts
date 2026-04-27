import 'dotenv/config'
import express, { type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { createMcpOAuthBridge } from '@solvapay/mcp/express'
import type { SolvaPayMerchantBranding } from '@solvapay/mcp-core'
import { createServer, fetchBranding } from './server'
import {
  mcpAssetOrigins,
  mcpPublicBaseUrl,
  solvapayApiBaseUrl,
  solvapayProductRef,
} from './config'

type JsonRpcId = string | number | null
type SessionEntry = {
  transport: StreamableHTTPServerTransport
}

const sessions: Record<string, SessionEntry> = {}

// Fetched once at startup and reused across every MCP `initialize`
// handshake. Cached so we don't re-hit `GET /v1/sdk/merchant` on every
// new session — branding rarely changes and the trade-off favours a
// snappy handshake. A long-running deployment can fail over to an
// empty branding snapshot via `process.emitWarning` if the prefetch
// errored.
let cachedBranding: SolvaPayMerchantBranding | undefined

const app = express()
app.use(express.json())
// OAuth token + revoke endpoints submit `application/x-www-form-urlencoded`
// per RFC 6749 §4.1.3 — without this parser, `req.body` stays empty and the
// bridge forwards an empty body upstream, which the backend rejects with
// `grant_type is required`. `express.json()` alone is NOT enough.
app.use(express.urlencoded({ extended: false }))
app.use(
  ...createMcpOAuthBridge({
    publicBaseUrl: mcpPublicBaseUrl,
    apiBaseUrl: solvapayApiBaseUrl,
    productRef: solvapayProductRef,
    requireAuth: true,
    mcpPath: '/mcp',
  }),
)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'mcp-checkout-app' })
})

app.post('/mcp', async (req: Request, res: Response) => {
  const id = (req.body as { id?: JsonRpcId } | undefined)?.id ?? null
  const sessionId =
    (req.headers['mcp-session-id'] as string | undefined) ||
    (typeof req.query.sessionId === 'string' ? req.query.sessionId : '') ||
    ''

  let transport: StreamableHTTPServerTransport | null = null
  if (sessionId && sessions[sessionId]) {
    transport = sessions[sessionId].transport
  }

  if (!transport && isInitializeRequest(req.body)) {
    const server = createServer(cachedBranding)

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        sessions[sid] = { transport: transport! }
      },
    })

    transport.onclose = () => {
      const sid = transport?.sessionId
      if (sid && sessions[sid]) {
        delete sessions[sid]
      }
    }

    await server.connect(transport)
  }

  if (!transport) {
    res.status(400).json({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: 'Bad Request: No valid session ID provided',
      },
    })
    return
  }

  await transport.handleRequest(req, res, req.body)
})

app.get('/mcp', async (req: Request, res: Response) => {
  const sessionId =
    (req.headers['mcp-session-id'] as string | undefined) ||
    (typeof req.query.sessionId === 'string' ? req.query.sessionId : '') ||
    ''

  if (!sessionId || !sessions[sessionId]) {
    res.status(400).json({ error: 'Missing or invalid MCP-Session-Id' })
    return
  }

  await sessions[sessionId].transport.handleRequest(req, res)
})

app.delete('/mcp', async (req: Request, res: Response) => {
  const sessionId =
    (req.headers['mcp-session-id'] as string | undefined) ||
    (typeof req.query.sessionId === 'string' ? req.query.sessionId : '') ||
    ''

  if (!sessionId || !sessions[sessionId]) {
    res.status(400).json({ error: 'Missing or invalid MCP-Session-Id' })
    return
  }

  await sessions[sessionId].transport.handleRequest(req, res)
})

const port = parseInt(process.env.MCP_PORT || '3006', 10)
const host = process.env.MCP_HOST || 'localhost'

// Warm the branding cache before accepting traffic so the very first
// `initialize` handshake carries merchant identity (brand name on the
// Implementation + iconUrl on tools/list) instead of the generic
// SolvaPay fallback. Failure is silent — the server still boots with
// the default identity.
fetchBranding()
  .then((branding) => {
    cachedBranding = branding
    if (branding) {
      console.error('[mcp-checkout-app] branding', {
        brandName: branding.brandName,
        iconUrl: branding.iconUrl,
        logoUrl: branding.logoUrl,
      })
    }
  })
  .catch(() => {
    /* ignore — server boots with default identity. */
  })

app.listen(port, host, () => {
  console.error(`MCP checkout app listening on http://${host}:${port}`)
  console.error('[mcp-checkout-app] config', {
    publicBaseUrl: mcpPublicBaseUrl,
    apiBaseUrl: solvapayApiBaseUrl,
    productRef: solvapayProductRef,
    // Surface the dev-only asset origins so it's obvious from the
    // startup log whether `MCP_ASSET_ORIGINS` landed in the process
    // env. If a merchant logo is CSP-blocked at `http://localhost:...`
    // and this array is empty, the .env wasn't reloaded — nodemon
    // doesn't watch `.env` unless it's in the `--watch` list.
    mcpAssetOrigins,
  })
})
