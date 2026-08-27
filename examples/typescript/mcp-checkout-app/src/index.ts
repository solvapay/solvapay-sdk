import 'dotenv/config'
import express from 'express'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpOAuthBridge, type McpOAuthBridgeOptions } from '@solvapay/mcp/express'
import type { SolvaPayMerchantBranding } from '@solvapay/mcp-core'
import { verifyProductConfiguration } from '@solvapay/server'
import { createServer, fetchBranding } from './server'
import {
  host,
  mcpPublicBaseUrl,
  port,
  solvaPay,
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
    oauthClient: solvaPay.apiClient,
  } as McpOAuthBridgeOptions),
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

// Branding is cosmetic, so it stays off the boot path — the server falls back
// to the default identity if it never resolves.
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

async function start(): Promise<void> {
  // Opt-in SDK check before the port opens. Shape validation + the one-line
  // mcp config summary already ran when the OAuth bridge was constructed;
  // this is the only deliberate network hop — a bad/missing product would
  // otherwise surface later as an opaque DCR 400 "Invalid identifier".
  const product = await verifyProductConfiguration({
    apiClient: solvaPay.apiClient,
    productRef: solvapayProductRef,
    apiBaseUrl: solvapayApiBaseUrl,
  })
  const plans = `${product.activePlans}/${product.totalPlans} plan(s) active`

  if (product.ready) {
    console.error(
      `[mcp-checkout-app] product "${product.name}" (${solvapayProductRef}) on ` +
        `${solvapayApiBaseUrl} — ${product.status}, ${plans}, ready to use`,
    )
  } else {
    console.error(
      `[mcp-checkout-app] product "${product.name}" (${solvapayProductRef}) on ` +
        `${solvapayApiBaseUrl} — ${product.status}, ${plans}, NOT ready to use: ` +
        `${product.issues.join('; ')}. Customers can connect and call free tools, but ` +
        'checkout and upgrades will fail. Fix this in SolvaPay Console → Products.',
    )
  }

  app.listen(port, host, () => {
    console.error(`MCP checkout app listening on http://${host}:${port}`)
  })
}

start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
