/**
 * MCP checkout app client entrypoint.
 *
 * Everything view-related (bootstrap, provider setup, view router, the
 * `<Mcp*View>` primitives, the shell, first-run tour, BackLink
 * primitive, and default styles) now lives in `@solvapay/react/mcp`.
 * This file only wires up the host-context helpers from
 * `@modelcontextprotocol/ext-apps`, constructs the `App`, passes the
 * slash-command hint list the server advertises, and renders
 * `<McpApp>`.
 *
 * All of these components (shell, views, tour, plan-actions helpers,
 * narrator) live in the SDK so the hosted MCP Pay solution can mount
 * the same surface on an HTTP page instead of inside the iframe.
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

/**
 * Slash-command hints surfaced under the About view's CTA cards.
 * Mirrors the prompts the MCP server registers on the server side —
 * listed here explicitly so hosts without slash-command UI (ChatGPT,
 * basic-host) still get a readable copy list instead of an empty
 * block.
 */
const SLASH_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'manage_account', description: 'See your plan, balance, and billing.' },
  { command: 'upgrade', description: 'Pick or change a paid plan.' },
  { command: 'topup', description: 'Add credits without leaving the chat.' },
  { command: 'check_usage', description: 'Usage snapshot for the current plan.' },
  { command: 'activate_plan', description: 'Activate a free, trial, or usage-based plan.' },
  { command: 'search_knowledge', description: 'Example paywalled tool (demo).' },
  { command: 'get_market_quote', description: 'Example paywalled tool (demo).' },
]

const app = new App({ name: 'SolvaPay checkout', version: '1.0.0' })

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element missing from mcp-app.html')
}

createRoot(rootEl).render(
  <McpApp app={app} applyContext={applyContext} slashCommands={SLASH_COMMANDS} />,
)
