/**
 * SolvaPay Server SDK
 *
 * Main entry point for the SolvaPay server-side SDK.
 * Provides unified payable API with explicit adapters for all frameworks.
 */

import crypto from 'node:crypto'
import type { WebhookEvent } from './types/webhook'
import {
  finishWebhookVerification,
  parseWebhookSignature,
  requireWebhookSecret,
  type VerifyWebhookOptions,
} from './webhook-signature'

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
 * (including the `whsec_` prefix). Signatures more than 5 minutes from now (either way) are
 * rejected, to prevent replay attacks.
 *
 * @param params - Webhook verification parameters
 * @param params.body - Raw request body as string (must be exactly as received)
 * @param params.signature - Value of the `SV-Signature` header
 * @param params.secret - Webhook signing secret from SolvaPay dashboard (`whsec_…`)
 * @param params.now - Time to check the timestamp against; defaults to now
 * @returns Parsed and typed {@link WebhookEvent} object
 * @throws {SolvaPayError} If the secret is empty, the signature is missing, malformed, outside the 5-minute
 *   window, or invalid, or the body is not JSON. `error.code` is one of
 *   {@link WEBHOOK_ERROR_CODES}.
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
  now,
}: VerifyWebhookOptions): WebhookEvent {
  requireWebhookSecret(secret)
  const parsed = parseWebhookSignature({ body, signature, now })
  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(parsed.signedPayload)
    .digest('hex')
  return finishWebhookVerification(expectedHmac, parsed, body)
}

export { WEBHOOK_ERROR_CODES, WEBHOOK_TOLERANCE_SECONDS } from './webhook-signature'
export type { VerifyWebhookOptions, WebhookErrorCode } from './webhook-signature'

// Export PaywallError for error handling
export { PaywallError, paywallErrorToClientPayload } from './paywall'
export type { ProtectHandlerContext } from './paywall'
export { isPaywallStructuredContent } from './types/paywall'

// Pure helper to build paywall gates from a `LimitResponse(WithPlan)`.
// Useful for streaming / SSE / multi-step handlers that can't fit the
// one-shot adapter shape but still want the SDK's gate copy.
export { buildPaywallGate } from './paywall-gate'
export { PaywallStructuredContentSchema } from './types/paywall-schema'

// Pure paywall state engine — classifier + gate / nudge copy builder.
// Exposed so transport adapters (`@solvapay/mcp-core`) can produce the
// same text-only copy off a `LimitResponseWithPlan` they already hold.
export {
  buildGateMessage,
  buildNudgeMessage,
  classifyPaywallState,
  creditSignals,
  linkLabel,
  nextActionFor,
  planLadder,
} from './paywall-state'
export type { CreditSignals, PaywallState } from './paywall-state'

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
  LimitAutoRechargeDto,
  LimitPlanSummary,
  LimitResponseWithPlan,
  SolvaPayClient,
  PayableOptions,
  FreeLimit,
  HttpAdapterOptions,
  NextAdapterOptions,
  PaywallArgs,
  PaywallDecision,
  PaywallMetadata,
  PaywallReason,
  PaywallStructuredContent,
  PaywallGateRecoveryFields,
  PaywallNextAction,
  RetryOptions,
  WebhookEvent,
  WebhookEventType,
  WebhookEventForType,
  WebhookEventObjectMap,
  CustomerWebhookObject,
  WebhookProduct,
} from './types'

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
  CreditActivityType,
  CreditActivityEntry,
  CreditActivityResult,
  GetHistoryResult,
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
  getHistoryCore,
  checkPurchaseCore,
  trackUsageCore,
  getUsageCore,
  deriveUsageSnapshot,
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
  UsageLimitsInput,
} from './helpers'
