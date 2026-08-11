import 'dotenv/config'
import express from 'express'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpOAuthBridge } from '@solvapay/mcp/express'
import { createServer } from './server'
import {
  mcpPublicBaseUrl,
  paywallEnabled,
  solvapayApiBaseUrl,
  solvapayProductRef,
} from './config'

// SDK v2 is stateless: no session map, no `initialize` routing. The factory
// runs per request and `createMcpHandler` owns the transport lifecycle.
const mcpHandler = createMcpHandler(() => createServer())

const app = express()
app.use(express.json())
// /oauth/token uses application/x-www-form-urlencoded; parse it so the bridge can forward it.
app.use(express.urlencoded({ extended: false }))
app.use(
  ...createMcpOAuthBridge({
    publicBaseUrl: mcpPublicBaseUrl,
    apiBaseUrl: solvapayApiBaseUrl,
    productRef: solvapayProductRef,
    requireAuth: paywallEnabled,
    mcpPath: '/mcp',
  }),
)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'mcp-time-app' })
})

// `toNodeHandler` streams SSE straight through and forwards `req.auth` (set by
// the OAuth bridge) as the handler's `authInfo`.
app.all('/mcp', toNodeHandler(mcpHandler))

const port = parseInt(process.env.MCP_PORT || '3005', 10)
const host = process.env.MCP_HOST || 'localhost'

app.listen(port, host, () => {
  console.error(`MCP time app listening on http://${host}:${port}`)
})
