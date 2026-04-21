import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createSolvaPayMcpServer } from '@solvapay/server/mcp'
import { mcpPublicBaseUrl, solvaPay, solvapayApiOrigin, solvapayProductRef } from './config'

const DIST_DIR = import.meta.filename.endsWith('.ts')
  ? path.join(import.meta.dirname, '../dist')
  : import.meta.dirname

const RESOURCE_URI = 'ui://mcp-checkout-app/mcp-app.html'

/**
 * Canonical "hello world" SolvaPay MCP server.
 *
 * `createSolvaPayMcpServer` handles every transport + bootstrap tool, the
 * UI resource, and the Stripe CSP baseline. Integrators who want extra
 * paywall-protected tools drop into `additionalTools` — everything else
 * stays declarative.
 */
export function createServer(): McpServer {
  return createSolvaPayMcpServer({
    solvaPay,
    productRef: solvapayProductRef,
    resourceUri: RESOURCE_URI,
    htmlPath: path.join(DIST_DIR, 'mcp-app.html'),
    publicBaseUrl: mcpPublicBaseUrl,
    csp: { connectDomains: [solvapayApiOrigin] },
    onToolCall: (name, args) => {
      if (process.env.SOLVAPAY_DEBUG === 'true') {
        console.error(`[mcp-checkout-app] -> ${name}`, args)
      }
    },
    onToolResult: (name, result, { durationMs }) => {
      if (process.env.SOLVAPAY_DEBUG === 'true') {
        const status = result.isError ? 'ERROR' : 'ok'
        console.error(`[mcp-checkout-app] <- ${name} ${status} in ${durationMs}ms`)
      }
    },
  })
}
