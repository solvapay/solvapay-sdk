/**
 * Cloudflare Workers MCP — client entrypoint.
 *
 * Bundled by vite into a single-file `dist/mcp-app.html`, then copied
 * into `src/assets/mcp-app.html` so Wrangler's `{ type: 'Text' }` rule
 * can inline it into the worker bundle (`import mcpAppHtml from
 * './assets/mcp-app.html'` in `worker.ts`).
 *
 * The iframe payload is runtime-agnostic (`@solvapay/mcp/fetch`).
 * Header comments differ per runtime; the body (from the first
 * `import` onward) is deliberately duplicated across the four
 * integrator-facing copies. See `docs/contributing/mcp-apps-sdk-rules.md`
 * ("Demo is not the SDK") and `tools/repo/example-widget-parity.test.ts`.
 */

import { createRoot } from 'react-dom/client'
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps'
import { McpApp } from '@solvapay/react/mcp'
import '@solvapay/react/styles.css'
import '@solvapay/react/mcp/styles.css'

function applyContext(ctx: McpUiHostContext | undefined) {
  if (!ctx) return
  if (ctx.theme) applyDocumentTheme(ctx.theme)
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables)
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts)

  const root = document.getElementById('root')
  const insets = ctx.safeAreaInsets
  if (insets && root) {
    root.style.paddingTop = `${16 + insets.top}px`
    root.style.paddingRight = `${16 + insets.right}px`
    root.style.paddingBottom = `${16 + insets.bottom}px`
    root.style.paddingLeft = `${16 + insets.left}px`
  }
}

const app = new App({ name: 'SolvaPay checkout', version: '1.0.0' })

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element missing from mcp-app.html')
}

createRoot(rootEl).render(<McpApp app={app} applyContext={applyContext} />)
