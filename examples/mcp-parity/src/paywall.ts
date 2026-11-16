/**
 * The legacy paywall server in TypeScript: customers sign in with SolvaPay,
 * and get_quote is checked against their plan and billed one unit per call.
 *
 *   pnpm paywall     # http://127.0.0.1:3060/mcp
 */
import { readFileSync } from 'node:fs'
import express from 'express'
import { z } from 'zod'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createSolvaPayMcpServer } from '@solvapay/mcp'
import { createMcpOAuthBridge } from '@solvapay/mcp/express'
import { createSolvaPay, createSolvaPayClient } from '@solvapay/server'
import { quote, required, WIDGET } from './shared'

const PORT = 3060
const apiBaseUrl = required('SOLVAPAY_API_BASE_URL')
const productRef = required('SOLVAPAY_PRODUCT_REF')
const publicBaseUrl = required('PAYWALL_TS_URL')
readFileSync(WIDGET) // fail now, not on the first account call

const solvaPay = createSolvaPay({
  apiClient: createSolvaPayClient({ apiKey: required('SOLVAPAY_SECRET_KEY'), apiBaseUrl }),
})

const mcpHandler = createMcpHandler(() =>
  createSolvaPayMcpServer({
    solvaPay,
    productRef,
    publicBaseUrl,
    htmlPath: WIDGET,
    resourceUri: 'ui://mcp-parity/mcp-app.html',
    serverName: 'paywall-typescript',
    csp: { connectDomains: [new URL(apiBaseUrl).origin] },
    additionalTools: ({ registerPayable }) => {
      registerPayable('get_quote', {
        title: 'Get quote',
        description: 'A made-up price for a ticker symbol. One unit per call.',
        schema: { symbol: z.string().min(1).max(8) },
        handler: async ({ symbol }, ctx) => ctx.respond(quote(symbol, 'typescript')),
      })
    },
  }),
)

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(...createMcpOAuthBridge({ publicBaseUrl, apiBaseUrl, productRef, mcpPath: '/mcp' }))
const handleMcp = toNodeHandler(mcpHandler)
app.all('/mcp', (req, res) => {
  void handleMcp(req, res, req.body)
})

app.listen(PORT, '127.0.0.1', () => {
  console.error(`[paywall-ts] http://127.0.0.1:${PORT}/mcp, public ${publicBaseUrl}/mcp`)
})
