/**
 * SolvaPay Server SDK
 *
 * Main entry point for the SolvaPay server-side SDK.
 * Provides unified payable API with explicit adapters for all frameworks.
 */

import { installNativeCoreApi } from '@solvapay/core'
import type { WebhookEvent } from './types/webhook'
import { installMcpAdapterNative } from './adapters/mcp'
import { callNativeSync, verifyWebhookNative } from './native'
import { rejectIfSeenEventIdSync } from './webhook-replay'
import type { VerifyWebhookOptions } from './webhook-replay'
import { installNativeDecisionApi } from './native-decisions'
import { publishNativeSyncApi } from './native-registry'
import type { PaywallStructuredContent, PaywallToolResult } from './types'

// Install sync decision + core dispatch for Node.
installNativeDecisionApi({ callNativeSync })
installNativeCoreApi({ callNativeSync })
installMcpAdapterNative({
  formatGate: (gate: PaywallStructuredContent): PaywallToolResult =>
    callNativeSync(
      'paywallToolResult',
      JSON.stringify({ message: gate.message, structuredContent: gate }),
    ) as PaywallToolResult,
})
// Ambient registry for mcp-core (and peers) — avoids server→mcp-core cycle
// and the createRequire CJS/ESM dual-instance trap.
publishNativeSyncApi()

// Main factory for unified API
export { createSolvaPay } from './factory'
export type {
  CreateSolvaPayConfig,
  SolvaPay,
  PayableFunction,
  PayableGateOptions,
  PayableGateResult,
  PayablePaywallResult,
  PayableAllowResult,
} from './factory'

// Re-export client creation (for advanced use cases)
export { createSolvaPayClient } from './client'
export type { ServerClientOptions } from './client'

// Opt-in product configuration check (never auto-invoked)
export { verifyProductConfiguration } from './verify-product-configuration'
export type {
  ProductConfigurationStatus,
  VerifyProductConfigurationOptions,
} from './verify-product-configuration'

/**
 * Verify webhook signature from SolvaPay backend.
 *
 * The backend sends an `SV-Signature` header in the format `t={timestamp},v1={hmac}`.
 * The HMAC is SHA-256 over `"{timestamp}.{rawBody}"` keyed by the full webhook secret
 * (including the `whsec_` prefix). Signatures older than 5 minutes are rejected.
 * That window is not event-id dedupe — pass `seenEventId` (or persist `event.id`)
 * so a retry inside the window is not processed twice.
 *
 * @param params - Webhook verification parameters
 * @param params.body - Raw request body as string (must be exactly as received)
 * @param params.signature - Value of the `SV-Signature` header
 * @param params.secret - Webhook signing secret from SolvaPay dashboard (`whsec_…`)
 * @param params.seenEventId - Optional host-owned replay check. Return `true`
 *   when `event.id` was already processed. The ±300 s signature window is not
 *   a substitute for event-id dedupe — retried deliveries reuse the same
 *   `event.id` (and `SV-Event-Id`) with a new `SV-Delivery`.
 * @returns Parsed and typed {@link WebhookEvent} object
 * @throws {SolvaPayError} If signature is missing, malformed, expired, or invalid,
 *   or when `seenEventId` reports a duplicate (`code: 'duplicate_event'`). Return
 *   HTTP 2xx for that code so SolvaPay stops retrying.
 *
 * @example
 * ```typescript
 * import { verifyWebhook } from '@solvapay/server';
 *
 * // Express.js — use express.raw() so the body is not parsed
 * app.post('/webhooks/solvapay', express.raw({ type: 'application/json' }), (req, res) => {
 *   try {
 *     const event = verifyWebhook({
 *       body: req.body.toString(),
 *       signature: req.headers['sv-signature'] as string,
 *       secret: process.env.SOLVAPAY_WEBHOOK_SECRET!,
 *     });
 *
 *     if (event.type === 'purchase.created') {
 *       // …
 *     }
 *
 *     res.json({ received: true });
 *   } catch (error) {
 *     res.status(401).json({ error: 'Invalid signature' });
 *   }
 * });
 * ```
 *
 * @see [Webhook Guide](../../../docs/guides/webhooks.md) for complete webhook handling examples
 * @since 1.0.0
 */
export function verifyWebhook({
  body,
  signature,
  secret,
  seenEventId,
}: VerifyWebhookOptions): WebhookEvent {
  // Rust-only after Step 53 — loader throws when `@solvapay/server-native`
  // is unavailable instead of silently running a duplicate `node:crypto` path.
  const event = verifyWebhookNative({ body, signature, secret })
  rejectIfSeenEventIdSync(event, seenEventId)
  return event
}

// MCP adapter (formatGate / formatResponse) — used by contract fixtures and
// advanced integrators that need the transport-shaped paywall payload without
// going through payable().mcp().
export { McpAdapter } from './adapters'

/** @internal Node native dispatch seams (fixture harness / package installs). */
export { callNativeSync } from './native'

/** §7.7 `{version, coreSha}` stamp from the installed `@solvapay/server-native` addon. */
export { nativeBuildInfo } from './build-info'
export type { NativeBuildInfo } from './build-info'

/**
 * @internal WASM client seams. The contract fixture harness loads the real
 * `@solvapay/server-wasm` client and installs it as an override so client
 * fixtures exercise the Rust `FetchTransport` (mockable via `globalThis.fetch`)
 * under Node — napi `reqwest` cannot be intercepted the same way.
 */
export { loadWasmBinding, getWasmClient, setWasmClientForTests, resetWasmCache } from './wasm'

// Export PaywallError for error handling
export { PaywallError } from './paywall'
// Payload builder delegates via native-decisions (Step 37R-c); keep the
// re-export chain explicit so the node-binding-delegation gate sees markers.
export { paywallErrorToClientPayload } from './native-decisions'
export type { ProtectHandlerContext } from './paywall'
export { isPaywallStructuredContent } from './types/paywall'

// Pure helper to build paywall gates from a `LimitResponse(WithPlan)`.
// Useful for streaming / SSE / multi-step handlers that can't fit the
// one-shot adapter shape but still want the SDK's gate copy.
export { buildPaywallGate } from './paywall-gate'

// Pure paywall state engine — classifier + gate / nudge copy builder.
// Exposed so transport adapters (`@solvapay/mcp-core`) can produce the
// same text-only copy off a `LimitResponseWithPlan` they already hold.
export {
  buildCustomerSnapshot,
  buildGateMessage,
  buildNudgeMessage,
  classifyPaywallState,
} from './paywall-state'
export type { PaywallState } from './paywall-state'

// Export virtual tools for MCP server monetization
export { createVirtualTools, VIRTUAL_TOOL_DEFINITIONS } from './virtual-tools'
export type { VirtualToolsOptions, VirtualToolDefinition } from './virtual-tools'
export { registerVirtualToolsMcpImpl, jsonSchemaToZodRawShape } from './register-virtual-tools-mcp'
export type { McpServerLike, RegisterVirtualToolsMcpOptions } from './register-virtual-tools-mcp'

// Export types
export type {
  components,
  LimitActivationBalance,
  LimitActivationProduct,
  LimitPlanSummary,
  LimitResponseWithPlan,
  SolvaPayClient,
  PayableOptions,
  HttpAdapterOptions,
  NextAdapterOptions,
  PaywallArgs,
  PaywallDecision,
  PaywallMetadata,
  PaywallStructuredContent,
  RetryOptions,
  WebhookEvent,
  WebhookEventType,
  WebhookEventForType,
  WebhookEventObjectMap,
  CustomerWebhookObject,
  WebhookProduct,
} from './types'
export type { SeenEventIdSync, VerifyWebhookOptions } from './webhook-replay'
export { WEBHOOK_DUPLICATE_EVENT_CODE } from './webhook-replay'

// Export payment processing types
export type {
  PurchaseInfo,
  OneTimePurchaseInfo,
  AttachBusinessDetailsParams,
  AttachBusinessDetailsResult,
  ProcessPaymentResult,
  TopupProcessResult,
  CustomerResponseMapped,
  ActivatePlanResult,
  PaymentMethodInfo,
  AutoRechargeConfig,
  AutoRechargeDisplayBlock,
  CreditDisplayBlock,
  AutoRechargeInput,
  SaveAutoRechargeInput,
  AutoRechargeResponse,
  SaveAutoRechargeResponse,
  McpBootstrapRequest,
  McpBootstrapResponse,
  McpBootstrapPlanInput,
  ConfigureMcpPlansRequest,
  ConfigureMcpPlansResponse,
  McpToolPlanMappingInput,
  ToolPlanMappingInput,
  SdkMerchantResponse,
  SdkProductResponse,
  CreditDebitSkipReason,
  CreditDebitResult,
  TrackUsageRequest,
  TrackUsageResponse,
  TrackUsageBulkRequest,
  TrackUsageBulkResponse,
  AssignCreditsRequest,
  AssignCreditsResponse,
} from './types/client'

// Export utilities for general use
export { withRetry } from './utils'

// Decision-core wrappers (Step 37R-c) — fixture harness + advanced integrators.
export {
  attachBusinessDetailsValidationError,
  buildCreateCustomerParams,
  classifyCancelError,
  classifyCreateError,
  classifyCustomerRef,
  classifyLookupError,
  classifyReactivateError,
  coerceCustomerOptions,
  decidePaywallOutcome,
  ensureCustomerNext,
  evaluateBalanceObservation,
  evaluateCachedLimits,
  evaluateFreshLimits,
  gateNext,
  extractBackendCustomerRef,
  isCachedCustomerRefValid,
  isEmailConflict,
  mapRouteError,
  resolveCustomerRef,
  normalizeCancelResponse,
  normalizeReactivateResponse,
  projectPaymentIntentResult,
  projectTopupProcessOutcome,
  topupProcessNext,
  projectUsageSnapshot,
  resolveCheckLimitsParams,
  resolveFallbackGateLimits,
  resolveProductRef,
  requireProductRef,
  resolvePurchaseCustomerRef,
  resolveReturnUrl,
  retryNextDelayMs,
  selectActivePurchases,
  shouldRetryUsageError,
  validateActivatePlanParams,
  validateAttachBusinessDetailsParams,
  validateCheckoutSessionParams,
  validateCreatePaymentIntentParams,
  validateGetProductParams,
  validateListPlansParams,
  validateProcessPaymentIntentParams,
  validatePurchaseRef,
  validateTopupPaymentIntentParams,
} from './native-decisions'

// Export route helpers (generic, framework-agnostic)
export {
  getAuthenticatedUserCore,
  syncCustomerCore,
  getCustomerBalanceCore,
  createPaymentIntentCore,
  createTopupPaymentIntentCore,
  processPaymentIntentCore,
  processTopupPaymentIntentCore,
  attachBusinessDetailsCore,
  createCheckoutSessionCore,
  createCustomerSessionCore,
  cancelPurchaseCore,
  reactivatePurchaseCore,
  activatePlanCore,
  getPaymentMethodCore,
  getAutoRechargeCore,
  saveAutoRechargeCore,
  disableAutoRechargeCore,
  checkPurchaseCore,
  trackUsageCore,
  getUsageCore,
  listPlansCore,
  checkLimitsCore,
  getMerchantCore,
  getProductCore,
  isErrorResult,
  handleRouteError,
  pollBalanceUntilIncreased,
  BALANCE_RECONCILE_DELAYS_MS,
  TOPUP_BALANCE_POLL_DELAYS_MS,
} from './helpers'
export type {
  ErrorResult,
  AuthenticatedUser,
  CustomerBalanceResult,
  PurchaseCheckResult,
  GetUsageResult,
} from './helpers'
