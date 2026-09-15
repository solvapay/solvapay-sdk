/**
 * Canonical MCP App widget entry for every language SDK.
 *
 * Vite + viteSingleFile emits `dist/mcp-app.html`, which is then
 * vendored into tools/mcp-app-widget/mcp-app.html and each SDK copy.
 * This file only wires host-context helpers from
 * `@modelcontextprotocol/ext-apps`, constructs the `App`, and renders
 * `<McpApp>` from `@solvapay/react/mcp`.
 */

import { installSolvaPayWidgetCore } from './install-widget-core'
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
  { name: 'SolvaPay MCP App', version: '1.0.0' },
  { availableDisplayModes: [...SOLVAPAY_MCP_APP_CAPABILITIES.availableDisplayModes] },
)

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element missing from mcp-app.html')
}

installSolvaPayWidgetCore()
createRoot(rootEl).render(<McpApp app={app} applyContext={applyContext} />)
