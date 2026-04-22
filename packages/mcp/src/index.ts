/**
 * `@solvapay/mcp` — framework-neutral MCP contracts for the SolvaPay
 * SDK. Provides tool names, result shape, paywall meta envelope, CSP
 * defaults, bootstrap payload, OAuth bridge, JWT helpers, and the
 * descriptor + payable handler builders that every SolvaPay MCP
 * adapter (`@solvapay/mcp-sdk`, future `mcp-lite` / `fastmcp`
 * adapters) maps onto its own registration API.
 *
 * This package is the single source of truth for shapes that cross the
 * server↔client boundary (bootstrap payload, tool names, view map). It
 * has no runtime dependency on `@modelcontextprotocol/sdk` or
 * `@modelcontextprotocol/ext-apps` — that's what `@solvapay/mcp-sdk`
 * adds on top.
 *
 * @example Build the descriptor bundle and hand it to an adapter:
 * ```ts
 * import { buildSolvaPayDescriptors } from '@solvapay/mcp'
 * import { createSolvaPayMcpServer } from '@solvapay/mcp-sdk'
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
  McpAdapterOptions,
  McpToolExtra,
  PaywallToolResult,
  SolvaPayCallToolResult,
  SolvaPayDocsResourceDescriptor,
  SolvaPayMcpCsp,
  SolvaPayMcpPaywallContent,
  SolvaPayMcpViewKind,
  SolvaPayPromptDescriptor,
  SolvaPayPromptResult,
  SolvaPayResourceDescriptor,
  SolvaPayToolDescriptor,
} from './types'

// ---- Core helpers ----
export {
  buildSolvaPayRequest,
  defaultGetCustomerRef,
  enrichPurchase,
  previewJson,
  toolErrorResult,
  toolResult,
} from './helpers'
export type { BuildSolvaPayRequestOptions } from './helpers'

// ---- Paywall envelope builders ----
export { buildPaywallUiMeta } from './paywall-meta'
export type { PaywallUiMeta, PaywallUiMetaInput } from './paywall-meta'

export { paywallToolResult } from './paywallToolResult'
export type { PaywallToolResultContext } from './paywallToolResult'

// ---- CSP baseline ----
export { SOLVAPAY_DEFAULT_CSP, mergeCsp } from './csp'

// ---- Descriptor + payable builders ----
export { buildSolvaPayDescriptors, buildSolvaPayPrompts } from './descriptors'
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

// ---- OAuth + bearer helpers ----
export { buildAuthInfoFromBearer } from './auth-bridge'
export type { BuildAuthInfoFromBearerOptions } from './auth-bridge'

export {
  createMcpOAuthBridge,
  createOAuthAuthorizeHandler,
  createOAuthRegisterHandler,
  createOAuthRevokeHandler,
  createOAuthTokenHandler,
  getOAuthAuthorizationServerResponse,
  getOAuthProtectedResourceResponse,
} from './oauth-bridge'
export type {
  McpOAuthBridgeOptions,
  OAuthAuthorizationServerOptions,
  OAuthAuthorizeHandlerOptions,
  OAuthBridgePaths,
  OAuthRegisterHandlerOptions,
  OAuthRevokeHandlerOptions,
  OAuthTokenHandlerOptions,
} from './oauth-bridge'

export {
  McpBearerAuthError,
  decodeJwtPayload,
  extractBearerToken,
  getCustomerRefFromBearerAuthHeader,
  getCustomerRefFromJwtPayload,
} from './bearer'
export type { McpBearerCustomerRefOptions } from './bearer'
