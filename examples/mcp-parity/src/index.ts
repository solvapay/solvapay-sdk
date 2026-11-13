/**
 * The parity server in TypeScript: one paid tool, `get_quote`, on a SolvaPay
 * MCP server whose customers sign in with SolvaPay.
 *
 *   pnpm serve          # MCP endpoint: http://localhost:$TS_PORT/mcp
 *
 * Reads ../.env (see .env.example). Every value is required: a missing one
 * stops the server.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import express from 'express'
import { z } from 'zod'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createSolvaPayMcpServer } from '@solvapay/mcp'
import { createMcpOAuthBridge } from '@solvapay/mcp/express'
import { createSolvaPay, createSolvaPayClient } from '@solvapay/server'

const HERE = import.meta.dirname
config({ path: path.join(HERE, '..', '.env'), quiet: true })

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. See examples/mcp-parity/README.md.`)
  return value
}

const apiBaseUrl = required('SOLVAPAY_API_BASE_URL')
const productRef = required('SOLVAPAY_PRODUCT_REF')
const publicBaseUrl = required('TS_PUBLIC_BASE_URL')
const port = Number(required('TS_PORT'))

// The widget every SDK ships, built once by mcp-app/. The Python package's
// copy is used so the three servers serve the same bytes without a build.
const WIDGET = path.join(HERE, '../../../python/src/solvapay/mcp/mcp-app.html')
readFileSync(WIDGET) // fail now, not on the first account call

const solvaPay = createSolvaPay({
  apiClient: createSolvaPayClient({ apiKey: required('SOLVAPAY_SECRET_KEY'), apiBaseUrl }),
})

/** A made-up price from the symbol, the same in every language. */
export function quote(symbol: string) {
  const upper = symbol.toUpperCase()
  let sum = 0
  for (const char of upper) sum += char.charCodeAt(0)
  return { symbol: upper, price: 100 + (sum % 900), currency: 'USD', server: 'typescript' }
}

const mcpHandler = createMcpHandler(() =>
  createSolvaPayMcpServer({
    solvaPay,
    productRef,
    publicBaseUrl,
    htmlPath: WIDGET,
    resourceUri: 'ui://mcp-parity/mcp-app.html',
    serverName: 'mcp-parity-typescript',
    csp: { connectDomains: [new URL(apiBaseUrl).origin] },
    additionalTools: ({ registerPayable }) => {
      registerPayable('get_quote', {
        title: 'Get quote',
        description: 'A made-up price for a ticker symbol. One unit per call.',
        schema: { symbol: z.string().min(1).max(8) },
        handler: async ({ symbol }, ctx) => ctx.respond(quote(symbol)),
      })
    },
  }),
)

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(...createMcpOAuthBridge({ publicBaseUrl, apiBaseUrl, productRef, mcpPath: '/mcp' }))
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', server: 'typescript' })
})
const handleMcp = toNodeHandler(mcpHandler)
app.all('/mcp', (req, res) => {
  void handleMcp(req, res, req.body)
})

app.listen(port, '127.0.0.1', () => {
  console.error(`[typescript] http://127.0.0.1:${port}/mcp, public ${publicBaseUrl}/mcp`)
})
