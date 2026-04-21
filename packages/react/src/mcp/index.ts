/**
 * `@solvapay/react/mcp` — MCP App integration for the SolvaPay React SDK.
 *
 * Import from `@solvapay/react/mcp` instead of `@solvapay/react` so the
 * `@modelcontextprotocol/ext-apps` peer stays optional for non-MCP
 * consumers:
 *
 * ```tsx
 * import { App } from '@modelcontextprotocol/ext-apps'
 * import { McpApp } from '@solvapay/react/mcp'
 * import '@solvapay/react/styles.css'
 * import '@solvapay/react/mcp/styles.css'
 *
 * const app = new App({ name: 'my-mcp-app', version: '1.0.0' })
 * createRoot(rootEl).render(<McpApp app={app} />)
 * ```
 *
 * Integrators who want a custom shell compose the per-view primitives
 * directly alongside `<SolvaPayProvider>` and `createMcpAppAdapter`.
 */

export { createMcpAppAdapter } from './adapter'
export type { McpAppLike } from './adapter'
export { MCP_TOOL_NAMES } from '@solvapay/mcp'
export type { McpToolName } from '@solvapay/mcp'

export { useStripeProbe } from './useStripeProbe'
export type { StripeProbeState } from './useStripeProbe'

export { fetchMcpBootstrap } from './bootstrap'
export type { McpBootstrap, McpView, McpAppBootstrapLike } from './bootstrap'

export { seedMcpCaches } from './cache-seed'

export { McpApp, McpViewRouter } from './McpApp'
export type {
  McpAppProps,
  McpAppFull,
  McpAppViewOverrides,
  McpUiHostContextLike,
  McpViewRouterProps,
} from './McpApp'

export { McpCheckoutView } from './views/McpCheckoutView'
export type { McpCheckoutViewProps } from './views/McpCheckoutView'

export { McpAccountView } from './views/McpAccountView'
export type { McpAccountViewProps } from './views/McpAccountView'

export { McpTopupView } from './views/McpTopupView'
export type { McpTopupViewProps } from './views/McpTopupView'

export { McpActivateView } from './views/McpActivateView'
export type { McpActivateViewProps } from './views/McpActivateView'

export { McpPaywallView } from './views/McpPaywallView'
export type { McpPaywallViewProps } from './views/McpPaywallView'

export { McpUsageView } from './views/McpUsageView'
export type { McpUsageViewProps } from './views/McpUsageView'

export { resolveMcpClassNames } from './views/types'
export type { McpViewClassNames } from './views/types'
