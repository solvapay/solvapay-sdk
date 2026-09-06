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
export { MCP_TOOL_NAMES } from '@solvapay/mcp-core'
export type { McpToolName } from '@solvapay/mcp-core'

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
  fetchMcpBootstrapViaResource,
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
  deriveActiveProducts,
  formatAllowanceTerms,
  formatProductTerms,
  formatSince,
} from './derive-active-products'
export type { ActiveProduct } from './derive-active-products'

export {
  resolvePlanShape,
  resolveActivationStrategy,
  resolvePlanActions,
  resolveActivityStrip,
  mergePlanSnapshot,
  findCatalogPlan,
} from './plan-actions'
export {
  ACCOUNT_STATES,
  resolveAccountState,
  resolveRemaining,
  resolveMeterTone,
  resolveRateDisplay,
  resolvePeriodDisplay,
  resolveOneTimeDisplay,
  resolveMerchantStrip,
  remainingCap,
  daysUntil,
  allowanceMeterUnit,
} from './account-state'
export type {
  PlanShape,
  ActivationStrategy,
  PlanActions,
  PlanActionsInput,
  ActivityStripKind,
  PlanLike,
  PurchaseSnapshotLike,
} from './plan-actions'
export type {
  AccountState,
  AccountStateInput,
  AccountLimitsLike,
  AccountPurchaseLike,
  RemainingDisplay,
  MeterTone,
  RateDisplay,
  PeriodDisplay,
  OneTimeDisplay,
} from './account-state'
export { planConsequence } from './plan-consequence'
export {
  CREDIT_ACTIVITY_TYPE_LABELS,
  mapCreditActivityRow,
  mapChargeRow,
  formatMerchantPlace,
  websiteHostLabel,
} from './history-rows'

export { BackLink } from './views/BackLink'
export type { BackLinkProps } from './views/BackLink'

export {
  AppHeader,
  HOSTS_WITH_MERCHANT_CHROME,
  type AppHeaderMode,
  type AppHeaderProps,
} from './views/AppHeader'

export {
  McpHostInfoProvider,
  useHostName,
  type McpHostInfoProviderProps,
} from './hooks/useHostInfo'

export {
  McpDisplayModeProvider,
  useDisplayMode,
  type McpDisplayModeProviderProps,
} from './hooks/useDisplayMode'

export {
  DEFAULT_DISPLAY_MODE_STATE,
  MCP_DISPLAY_MODES,
  MCP_HOSTED_MIN_WIDTH,
  SOLVAPAY_MCP_APP_CAPABILITIES,
  hostSafeAreaPadding,
  hostWidthPx,
  isMcpDisplayMode,
  readDisplayModeState,
  resolveHostedRail,
} from './display-mode'
export type {
  McpContainerDimensions,
  McpDisplayMode,
  McpDisplayModeState,
  McpHostedRail,
  McpSafeAreaInsets,
} from './display-mode'

export { McpCheckoutView } from './views/McpCheckoutView'
export type { McpCheckoutViewProps } from './views/McpCheckoutView'

export { McpAccountView } from './views/McpAccountView'
export type { McpAccountViewProps } from './views/McpAccountView'

export { McpPayingAs } from './views/McpPayingAs'
export type { McpPayingAsProps } from './views/McpPayingAs'

export { McpTopupView } from './views/McpTopupView'
export type { McpTopupViewProps } from './views/McpTopupView'

export { McpAutoRechargeView } from './views/McpAutoRechargeView'
export type { McpAutoRechargeViewProps } from './views/McpAutoRechargeView'

// Paywall / nudge surfaces were removed as part of the text-only
// paywall refactor. Merchant paywall / nudge responses are plain
// narrations now — hosts render them in text and the widget iframe is
// reserved for deliberate intent-tool calls (`upgrade` /
// `manage_account` / `topup`).
//
// `McpSellerDetailsCard` / `McpCustomerDetailsCard` and
// `McpAccountView.hideDetailCards` were removed with the sidebar.
// Identity is `McpPayingAs` inside the payment form. See
// `packages/react/docs/mcp-app-architecture.md`.

export { resolveMcpClassNames } from './views/types'
export type { McpViewClassNames } from './views/types'

export {
  AmountLadder,
  AttributionFooter,
  Eyebrow,
  FactBand,
  Field,
  LedgerRow,
  LineItem,
  MCP_USAGE_CRITICAL_AT,
  MCP_USAGE_WARNING_AT,
  McpUsageMeter,
  Pill,
  PlanRow,
  PresetTile,
  Section,
  SplitRow,
  StatusDot,
  StatusPill,
  Toggle,
  mcpUsageWarningAt,
  sanitizeDecimalInput,
  statusPillTone,
} from './primitives'
export type {
  AmountLadderRow,
  FactBandItem,
  McpUsageMeterProps,
  StatusPillTone,
} from './primitives'
