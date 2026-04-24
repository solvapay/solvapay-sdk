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

export { useHostLocale } from './useHostLocale'

export { useMcpToolResult } from './hooks/useMcpToolResult'
export type { McpToolResult } from './hooks/useMcpToolResult'

export { McpBridgeProvider, useMcpBridge } from './bridge'
export type {
  McpBridgeAppLike,
  McpBridgeProviderProps,
  McpBridgeValue,
  McpMessageOnSuccess,
  McpSuccessEvent,
  NotifyModelContextParams,
  SendMessageParams,
} from './bridge'

export {
  classifyHostEntry,
  fetchMcpBootstrap,
  isTransportToolName,
  parseBootstrapFromToolResult,
  SOLVAPAY_TRANSPORT_TOOL_NAMES,
  waitForInitialToolResult,
} from './bootstrap'
export type {
  AppToolResultEvents,
  HostEntryClassification,
  McpAppBootstrapLike,
  McpBootstrap,
  McpView,
  WaitForInitialToolResultOptions,
  WaitForInitialToolResultResult,
} from './bootstrap'

export { seedMcpCaches } from './cache-seed'

export { McpApp, McpViewRouter } from './McpApp'
export type {
  McpAppProps,
  McpAppFull,
  McpAppViewOverrides,
  McpUiHostContextLike,
  McpViewRouterProps,
} from './McpApp'

export { McpAppShell } from './McpAppShell'
export type { McpAppShellProps } from './McpAppShell'

export type { McpViewKind, McpTabKind } from './view-kind'

export {
  resolvePlanShape,
  resolveActivationStrategy,
  resolvePlanActions,
  resolveActivityStrip,
} from './plan-actions'
export type {
  PlanShape,
  ActivationStrategy,
  PlanActions,
  PlanActionsInput,
  ActivityStripKind,
  PlanLike,
  PurchaseSnapshotLike,
} from './plan-actions'

export { BackLink } from './views/BackLink'
export type { BackLinkProps } from './views/BackLink'

export { McpCheckoutView } from './views/McpCheckoutView'
export type { McpCheckoutViewProps } from './views/McpCheckoutView'

export { McpAccountView } from './views/McpAccountView'
export type { McpAccountViewProps } from './views/McpAccountView'

export { McpCustomerDetailsCard, McpSellerDetailsCard } from './views/detail-cards'
export type {
  McpCustomerDetailsCardProps,
  McpSellerDetailsCardProps,
} from './views/detail-cards'

export { McpTopupView } from './views/McpTopupView'
export type { McpTopupViewProps } from './views/McpTopupView'

export { McpPaywallView } from './views/McpPaywallView'
export type { McpPaywallViewProps } from './views/McpPaywallView'

export { McpNudgeView } from './views/McpNudgeView'
export type { McpNudgeViewProps } from './views/McpNudgeView'

export { McpUpsellStrip } from './components/McpUpsellStrip'
export type { McpUpsellStripProps } from './components/McpUpsellStrip'

export { resolveMcpClassNames } from './views/types'
export type { McpViewClassNames } from './views/types'
