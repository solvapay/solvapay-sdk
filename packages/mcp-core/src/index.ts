/**
 * `@solvapay/mcp-core` — framework-neutral MCP contracts for the SolvaPay
 * SDK. Provides tool names, result shape, paywall meta envelope, CSP
 * defaults, bootstrap payload, pure OAuth discovery JSON builders, bearer
 * / JWT helpers, and the descriptor + payable handler builders that every
 * SolvaPay MCP adapter (`@solvapay/mcp`, future `fastmcp` / raw JSON-RPC
 * adapters) maps onto its own registration API.
 *
 * This package is the single source of truth for shapes that cross the
 * server↔client boundary (bootstrap payload, tool names, view map). It
 * has no runtime dependency on `@modelcontextprotocol/sdk`,
 * `@modelcontextprotocol/ext-apps`, Express, or any runtime-specific OAuth
 * middleware — those live in `@solvapay/mcp`, `@solvapay/mcp-express`,
 * and `@solvapay/mcp-fetch` respectively.
 *
 * @example Build the descriptor bundle and hand it to an adapter:
 * ```ts
 * import { buildSolvaPayDescriptors } from '@solvapay/mcp-core'
 * import { createSolvaPayMcpServer } from '@solvapay/mcp'
 *
 * const server = createSolvaPayMcpServer({
 *   solvaPay,
 *   productRef: 'prd_video',
 *   resourceUri: 'ui://my-app/mcp-app.html',
 *   htmlPath: '/dist/mcp-app.html',
 *   publicBaseUrl: 'https://my-app.example.com',
 * })
 * ```
 */

// ---- Tool name contract (shared with @solvapay/react/mcp) ----
export { MCP_TOOL_NAMES } from './tool-names'
export type { McpToolName } from './tool-names'

// ---- Neutral types ----
export {
  OPEN_TOOL_FOR_VIEW,
  SOLVAPAY_MCP_VIEW_KINDS,
  TOOL_FOR_VIEW,
  VIEW_FOR_OPEN_TOOL,
  VIEW_FOR_TOOL,
} from './types'
export type {
  BootstrapCustomer,
  BootstrapMerchant,
  BootstrapPayload,
  BootstrapPlan,
  BootstrapProduct,
  ContentBlock,
  CustomerSnapshot,
  McpAdapterOptions,
  McpToolExtra,
  NudgeSpec,
  PayableHandler,
  PaywallToolResult,
  ResponseContext,
  ResponseOptions,
  ResponseResult,
  SolvaPayCallToolResult,
  SolvaPayDocsResourceDescriptor,
  SolvaPayMcpCsp,
  SolvaPayMcpViewKind,
  SolvaPayMerchantBranding,
  SolvaPayPromptDescriptor,
  SolvaPayPromptResult,
  SolvaPayResourceDescriptor,
  SolvaPayToolAnnotations,
  SolvaPayToolDescriptor,
  SolvaPayToolIcon,
} from './types'

// ---- Core helpers ----
export {
  buildSolvaPayRequest,
  defaultGetCustomerRef,
  enrichPurchase,
  narratedToolResult,
  parseMode,
  previewJson,
  toolErrorResult,
  toolResult,
} from './helpers'
export type { BuildSolvaPayRequestOptions, SolvaPayToolMode } from './helpers'

// ---- Narrators (per-tool text-mode renderers) ----
export {
  NARRATORS,
  narrateManageAccount,
  narrateUpgrade,
  narrateTopup,
  narrateActivatePlan,
  uiPlaceholder,
  balanceSummary,
} from './narrate'
export type { IntentTool, NarratorOutput } from './narrate'

// ---- Paywall envelope builders ----
//
// The `paywall-meta` module (`buildPaywallUiMeta`, `PaywallUiMeta`,
// `PaywallUiMetaInput`) was deleted as part of the text-only paywall
// refactor: MCP Apps hosts open the widget from descriptor-level
// `_meta.ui.resourceUri` on `tools/list`, and the merchant payable
// path deliberately doesn't advertise it, so per-call `_meta.ui`
// stamping has no consumers. Downstream code that constructed its
// own `_meta.ui` envelope with this helper should drop it outright —
// the descriptor is the only trigger now.
export { paywallToolResult } from './paywallToolResult'
export type { PaywallToolResultContext } from './paywallToolResult'

// ---- CSP baseline ----
export { SOLVAPAY_DEFAULT_CSP, mergeCsp } from './csp'

// ---- Descriptor + payable builders ----
export { applyHideToolsByAudience } from './hideToolsByAudience'
export { buildSolvaPayDescriptors, buildSolvaPayPrompts, deriveIcons } from './descriptors'
export type {
  BuildSolvaPayDescriptorsOptions,
  SolvaPayDescriptorBundle,
} from './descriptors'

export {
  SOLVAPAY_OVERVIEW_MARKDOWN,
  SOLVAPAY_OVERVIEW_MIME_TYPE,
  SOLVAPAY_OVERVIEW_URI,
} from './resources/overview'

export { createBuildBootstrapPayload } from './bootstrap-payload'
export type {
  BuildBootstrapPayloadFn,
  CreateBuildBootstrapPayloadOptions,
} from './bootstrap-payload'

export { buildPayableHandler } from './payable-handler'
export type { BuildPayableHandlerContext } from './payable-handler'

// ---- OAuth discovery (pure JSON, framework-neutral) ----
export {
  DEFAULT_OAUTH_PATHS,
  getOAuthAuthorizationServerResponse,
  getOAuthProtectedResourceResponse,
  resolveOAuthPaths,
  withoutTrailingSlash,
} from './oauth-discovery'
export type {
  OAuthAuthorizationServerOptions,
  OAuthBridgePaths,
} from './oauth-discovery'

// ---- Auth info + bearer helpers ----
export { buildAuthInfoFromBearer } from './auth-bridge'
export type { BuildAuthInfoFromBearerOptions } from './auth-bridge'

export {
  McpBearerAuthError,
  decodeJwtPayload,
  extractBearerToken,
  getCustomerRefFromBearerAuthHeader,
  getCustomerRefFromJwtPayload,
} from './bearer'
export type { McpBearerCustomerRefOptions } from './bearer'
