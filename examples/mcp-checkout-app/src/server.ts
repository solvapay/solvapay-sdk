import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createSolvaPayMcpServer } from '@solvapay/mcp-sdk'
import {
  mcpAssetOrigins,
  mcpPublicBaseUrl,
  solvaPay,
  solvapayApiOrigin,
  solvapayProductRef,
} from './config'
import { demoToolsEnabled, registerDemoTools } from './demo-tools'

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
 *
 * When `DEMO_TOOLS` is unset (or not `"false"`), two paywalled demo
 * tools (`search_knowledge`, `get_market_quote`) + their slash-command
 * prompts land on the server so the paywall flow can be exercised from
 * `basic-host` without hand-rolling a gated tool. See
 * `examples/mcp-checkout-app/src/demo-tools.ts`.
 */
export function createServer(): McpServer {
  // Allow the merchant logo + other provider-served assets to load from
  // the SolvaPay API origin + any extra origins declared via
  // `MCP_ASSET_ORIGINS` (typically `http://localhost:<port>` in dev).
  // Goes through `resource_domains` because `img-src` / `style-src`
  // live there; `connect_domains` would only help for `fetch()` /
  // `XHR`, not `<img>` tags.
  const resourceDomains = Array.from(
    new Set([solvapayApiOrigin, ...mcpAssetOrigins]),
  )

  return createSolvaPayMcpServer({
    solvaPay,
    productRef: solvapayProductRef,
    resourceUri: RESOURCE_URI,
    htmlPath: path.join(DIST_DIR, 'mcp-app.html'),
    publicBaseUrl: mcpPublicBaseUrl,
    csp: {
      connectDomains: [solvapayApiOrigin],
      resourceDomains,
    },
    additionalTools: demoToolsEnabled() ? registerDemoTools : undefined,
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
