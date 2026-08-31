import 'dotenv/config'
import express from 'express'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpOAuthBridge, type McpOAuthBridgeOptions } from '@solvapay/mcp/express'
import { MCP_TOOL_NAMES, type SolvaPayMerchantBranding } from '@solvapay/mcp-core'
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

const REQUIRED_TRANSPORT_TOOLS = [
  MCP_TOOL_NAMES.createPayment,
  MCP_TOOL_NAMES.processPayment,
  MCP_TOOL_NAMES.createTopupPayment,
  MCP_TOOL_NAMES.attachBusinessDetails,
] as const

const mcpHandler = createMcpHandler(() => createServer(cachedBranding), {
  onerror: error => {
    console.error('[mcp-checkout-app] MCP handler error', error)
  },
})

function parseSseJsonRpc(body: string): unknown {
  const dataLine = body.split('\n').find(line => line.startsWith('data:'))
  if (dataLine === undefined) {
    throw new Error(
      `[mcp-checkout-app] tools/list boot check expected SSE data: frame, got: ${body}`,
    )
  }
  return JSON.parse(dataLine.slice(dataLine.indexOf(':') + 1).trim()) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

async function assertTransportToolsListed(): Promise<void> {
  const response = await mcpHandler.fetch(
    new Request('http://127.0.0.1/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    }),
  )
  const body = await response.text()
  if (!response.ok) {
    throw new Error(
      `[mcp-checkout-app] tools/list boot check failed: HTTP ${response.status} ${body}`,
    )
  }
  const rpc = parseSseJsonRpc(body)
  const result = isRecord(rpc) && isRecord(rpc.result) ? rpc.result : undefined
  const tools = result !== undefined && Array.isArray(result.tools) ? result.tools : []
  const names = new Set(
    tools
      .map(tool => (isRecord(tool) && typeof tool.name === 'string' ? tool.name : ''))
      .filter(name => name.length > 0),
  )
  const missing = REQUIRED_TRANSPORT_TOOLS.filter(name => !names.has(name))
  if (missing.length > 0) {
    throw new Error(
      `[mcp-checkout-app] SolvaPay MCP server is missing required UI transport tool(s): ${missing.join(', ')}. ` +
        'The checkout UI calls these on every checkout, so a stale or skewed @solvapay/* build blocks the ' +
        'Payment step with "MCP error -32602: Tool <name> not found" (DEV-650). Rebuild the workspace packages ' +
        '(`pnpm build:packages`) or run the server from source (`NODE_OPTIONS=--conditions=development`) so it ' +
        'matches the Vite-built UI bundle.',
    )
  }
  if (process.env.SOLVAPAY_DEBUG === 'true') {
    for (const tool of tools) {
      if (!isRecord(tool) || typeof tool.name !== 'string') continue
      console.error(`[mcp-checkout-app] descriptor ${tool.name}`, {
        _meta: tool._meta,
        annotations: tool.annotations,
      })
    }
  }
}

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

  await assertTransportToolsListed()

  app.listen(port, host, () => {
    console.error(`MCP checkout app listening on http://${host}:${port}`)
  })
}

start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
