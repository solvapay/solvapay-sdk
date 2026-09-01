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
 * has no runtime dependency on `@modelcontextprotocol/core` / `/server`,
 * `@modelcontextprotocol/ext-apps`, Express, or any runtime-specific OAuth
 * middleware — those live in `@solvapay/mcp` (root entry),
 * `@solvapay/mcp/express`, and `@solvapay/mcp/fetch` respectively.
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
  SolvaPayBootstrapResourceDescriptor,
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
  narratedToolResult,
  parseMode,
  previewJson,
  toolErrorResult,
  toolResult,
} from './helpers'
export type { BuildSolvaPayRequestOptions, SolvaPayToolMode } from './helpers'

// ---- Credit → fiat display + product-ref helpers (re-exported from @solvapay/core) ----
export {
  SOLVAPAY_PRODUCT_REF_PLACEHOLDER,
  assertValidProductRef,
  creditsToDisplayMinorUnits,
  evaluateProductReadiness,
  isZeroDecimalCurrency,
  minorUnitsPerMajor,
} from '@solvapay/core'
export type { ProductReadinessInput, ProductReadinessResult } from '@solvapay/core'

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
export { invokePayableNext, paywallToolResult } from './native-mcp'
export type { PaywallToolResultContext } from './paywallToolResult'

// ---- Response envelope helpers (adapter-internal) ----
//
// Used by `ctx.respond(...)` / `buildPayableHandler`. Not part of the
// merchant-facing `@solvapay/mcp` public entry — exported here so the
// contract harness and adapters can share the same constructors.
export { assertResponseResult, makeResponseResult } from './native-mcp'
export { callMcpSyncOp, getMcpToolNamesTable, mcpViewMaps, installNativeMcpApi } from './native-mcp'
export { mcpWidgetResource } from './native-mcp.generated'
export { runMcpEngineRequest } from './engine-dispatch'
export type {
  McpEngineConfig,
  McpEngineHttpResult,
  McpEnginePayable,
  McpPayableToolSpec,
} from './engine-dispatch'

// ---- CSP baseline ----
export { SOLVAPAY_DEFAULT_CSP, mergeCsp } from './csp'

// ---- Descriptor + payable builders ----
export { hideToolsByAudience } from './hideToolsByAudience'
export { mcpDescriptors } from './mcp-descriptors'
export type {
  McpDescriptorTool,
  McpDescriptorsBundle,
  McpDescriptorsInput,
} from './mcp-descriptors'
export { buildSolvaPayDescriptors, buildSolvaPayPrompts } from './descriptors'
export type { BuildSolvaPayDescriptorsOptions, SolvaPayDescriptorBundle } from './descriptors'
export {
  deriveIcons,
  buildPromptDescriptorMetadata,
  buildPromptUserMessage,
  buildToolDescriptorMetadata,
  validatePublicBaseUrl,
} from './native-mcp'
export { INTENT_TOOL_ANNOTATIONS, PUBLIC_BASE_URL_ERROR, solvapayTool } from './descriptor-metadata'
export type {
  BuildPromptDescriptorMetadataOptions,
  BuildToolDescriptorMetadataOptions,
  PromptDescriptorMetadata,
  ToolDescriptorMetadata,
} from './descriptor-metadata'

export { SOLVAPAY_BOOTSTRAP_MIME_TYPE, SOLVAPAY_BOOTSTRAP_URI } from './resources/bootstrap'

export {
  solvapayOverviewBody,
  SOLVAPAY_OVERVIEW_MIME_TYPE,
  SOLVAPAY_OVERVIEW_URI,
} from './resources/overview'

export { buildPayableHandler } from './payable-handler'
export type { BuildPayableHandlerContext } from './payable-handler'

// ---- Config logging + DCR diagnostics (framework-neutral) ----
export { logMcpConfigOnce, mcpConfigLogMessage, resetMcpConfigLogForTests } from './config-log'
export type { McpConfigLogInput } from './config-log'
export { logDcrFailureDiagnostic } from './dcr-diagnostics'
export type { DcrFailureDiagnosticInput } from './dcr-diagnostics'

// ---- OAuth discovery (pure JSON, framework-neutral) ----
export {
  DEFAULT_OAUTH_PATHS,
  getOAuthAuthorizationServerResponse,
  getOAuthProtectedResourceResponse,
  mcpResourceIdentifier,
  pathAwareProtectedResourcePath,
  resolveOAuthPaths,
  withLeadingSlash,
  withoutTrailingSlash,
} from './oauth-discovery'
export type { OAuthAuthorizationServerOptions, OAuthBridgePaths } from './oauth-discovery'

export {
  buildErrorDescription,
  deriveOAuthErrorCode,
  hasOAuthErrorShape,
  toOAuthErrorBody,
  VALID_OAUTH_TOKEN_ERROR_CODES,
} from './oauth-error-normalize'
export type { OAuthErrorBody, OAuthTokenErrorCode } from './oauth-error-normalize'

export { mcpAuthGate } from './auth-gate'
export type { McpAuthGateChallenge, McpAuthGateInput, McpAuthGateResult } from './auth-gate'

// ---- Auth info + bearer helpers ----
export { buildAuthInfoFromBearer } from './auth-bridge'
export type { BuildAuthInfoFromBearerOptions, McpAuthInfoExtras } from './auth-bridge'

export {
  McpBearerAuthError,
  decodeJwtPayload,
  defaultMcpBearerExpectations,
  extractBearerToken,
  getCustomerRefFromBearerAuthHeader,
  getCustomerRefFromJwtPayload,
  verifyBearer,
} from './bearer'
export type {
  McpBearerCustomerRefOptions,
  McpVerifyBearerOptions,
  McpVerifyBearerResult,
} from './bearer'
export { cachedJwks, jwksUrlFromIssuer, resetJwksCacheForTests } from './jwks-cache'

/** True for MCP methods that must not require bearer auth (everything except tools/call). */
export { isFreeMcpMethod, requiresBearerAuth } from './is-free-mcp-method'
export type { McpAuthMode } from './is-free-mcp-method'
