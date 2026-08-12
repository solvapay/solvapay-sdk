import 'dotenv/config'
import express from 'express'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpOAuthBridge } from '@solvapay/mcp/express'
import type { SolvaPayMerchantBranding } from '@solvapay/mcp-core'
import { createServer, fetchBranding } from './server'
import {
  host,
  mcpAssetOrigins,
  mcpPublicBaseUrl,
  port,
  solvapayApiBaseUrl,
  solvapayProductRef,
} from './config'

let cachedBranding: SolvaPayMerchantBranding | undefined

const mcpHandler = createMcpHandler(() => createServer(cachedBranding))

const app = express()
app.use(express.json())
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

// `toNodeHandler` streams SSE straight through and forwards `req.auth` (set by
// the OAuth bridge) as the handler's `authInfo`. Pass `req.body` explicitly —
// Express invokes middleware as `(req, res, next)`, and `toNodeHandler` would
// otherwise treat `next` as a function and discard it, then try to re-read the
// already-consumed stream (→ "Parse error: Invalid JSON" after OAuth succeeds).
const handleMcp = toNodeHandler(mcpHandler)
app.all('/mcp', (req, res) => {
  void handleMcp(req, res, req.body)
})

fetchBranding()
  .then(branding => {
    cachedBranding = branding
    if (branding) {
      console.error('[mcp-checkout-app] branding', {
        brandName: branding.brandName,
        iconUrl: branding.iconUrl,
        logoUrl: branding.logoUrl,
      })
    }
  })
  .catch(error => {
    console.error('[mcp-checkout-app] branding fetch failed, using default identity', error)
  })

app.listen(port, host, () => {
  console.error(`MCP checkout app listening on http://${host}:${port}`)
  console.error('[mcp-checkout-app] config', {
    publicBaseUrl: mcpPublicBaseUrl,
    apiBaseUrl: solvapayApiBaseUrl,
    productRef: solvapayProductRef,
    mcpAssetOrigins,
  })
})
