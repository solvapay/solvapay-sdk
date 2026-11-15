/**
 * The SolvaPay MCP App widget: checkout, account and top-up, as the
 * TypeScript SDK's examples serve it (`examples/mcp-checkout-app`,
 * `examples/cloudflare-workers-mcp`).
 *
 * Built into one `dist/mcp-app.html` that the Python SDK ships in its wheel
 * (`python/src/solvapay/mcp/mcp-app.html`, kept in sync by
 * `python/scripts/sync_widget.py`). It holds nothing merchant-specific: the
 * merchant, product, plans and return URL arrive at runtime in the `account`
 * tool's bootstrap payload.
 */

import { createRoot } from 'react-dom/client'
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps'
import { McpApp, SOLVAPAY_MCP_APP_CAPABILITIES } from '@solvapay/react/mcp'
import '@solvapay/react/styles.css'
import '@solvapay/react/mcp/styles.css'

function applyContext(ctx: McpUiHostContext | undefined) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)
}

const app = new App(
  { name: 'SolvaPay checkout', version: '1.0.0' },
  { availableDisplayModes: [...SOLVAPAY_MCP_APP_CAPABILITIES.availableDisplayModes] },
)

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element missing from mcp-app.html')
}

createRoot(rootEl).render(<McpApp app={app} applyContext={applyContext} />)
