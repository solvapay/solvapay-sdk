/**
 * SolvaPay Server SDK - Edge Runtime Entry Point
 *
 * This module provides edge runtime-compatible exports using Web Crypto API.
 * Automatically selected when running in edge runtimes (Vercel Edge, Cloudflare Workers, Deno, etc.)
 */

import type { WebhookEvent } from './types/webhook'
import {
  finishWebhookVerification,
  parseWebhookSignature,
  requireWebhookSecret,
  type VerifyWebhookOptions,
} from './webhook-signature'

// Re-export the main client which is already edge-compatible (uses fetch)
export { createSolvaPayClient } from './client'
export type { ServerClientOptions } from './client'

// Opt-in product configuration check (never auto-invoked)
export { verifyProductConfiguration } from './verify-product-configuration'
export type {
  ProductConfigurationStatus,
  VerifyProductConfigurationOptions,
} from './verify-product-configuration'

// Re-export factory for unified API
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

// Export PaywallError for error handling
export { PaywallError, paywallErrorToClientPayload } from './paywall'

// Paywall type-guard + state engine — exported here so edge / Deno
// consumers of `@solvapay/server` (notably `@solvapay/mcp-core`, which
// Deno resolves via the `deno` export condition to `./dist/edge.js`)
// can pull the same narration + discrimination helpers the Node entry
// point already ships. Pure modules — safe on every edge runtime.
export { isPaywallStructuredContent } from './types/paywall'
export { PaywallStructuredContentSchema } from './types/paywall-schema'
export {
  buildGateMessage,
  buildNudgeMessage,
  classifyPaywallState,
  creditSignals,
  linkLabel,
  nextActionFor,
  planLadder,
} from './paywall-state'
export { buildPaywallGate } from './paywall-gate'
export type { CreditSignals, PaywallState } from './paywall-state'
export type { PaywallDecision } from './types/paywall'

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

// Export payment processing types (shared surface with the Node
// entrypoint — `@solvapay/mcp-core` imports these via its top-level
// `@solvapay/server` import, which Deno resolves to `edge.js`).
export type {
  OneTimePurchaseInfo,
  ProcessPaymentResult,
  TopupProcessResult,
  CustomerResponseMapped,
  ActivatePlanResult,
  PaymentMethodInfo,
  McpBootstrapRequest,
  McpBootstrapResponse,
  McpBootstrapPlanInput,
  ConfigureMcpPlansRequest,
  ConfigureMcpPlansResponse,
  McpToolPlanMappingInput,
  ToolPlanMappingInput,
  SdkMerchantResponse,
  SdkProductResponse,
} from './types/client'

// Export retry utility for general use
export { withRetry } from './utils'

// Export route helpers (generic, framework-agnostic)
// These work in edge runtimes as they use standard Web API Request
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
  checkPurchaseCore,
  trackUsageCore,
  getUsageCore,
  deriveUsageSnapshot,
  listPlansCore,
  checkLimitsCore,
  getMerchantCore,
  getProductCore,
  getPaymentMethodCore,
  getAutoRechargeCore,
  saveAutoRechargeCore,
  disableAutoRechargeCore,
  getHistoryCore,
  isErrorResult,
  handleRouteError,
} from './helpers'
export type {
  ErrorResult,
  AuthenticatedUser,
  CustomerBalanceResult,
  PurchaseCheckResult,
  GetUsageResult,
} from './helpers'

/**
 * Verify webhook signature using edge-compatible Web Crypto API.
 *
 * The backend sends an `SV-Signature` header in the format `t={timestamp},v1={hmac}`.
 * The HMAC is SHA-256 over `"{timestamp}.{rawBody}"` keyed by the full webhook secret
 * (including the `whsec_` prefix). Signatures more than 5 minutes from now (either way) are
 * rejected, to prevent replay attacks.
 *
 * Works in: Vercel Edge Functions, Cloudflare Workers, Deno, Supabase Edge Functions.
 *
 * @param params.body - Raw webhook request body (string)
 * @param params.signature - Value of the `SV-Signature` header
 * @param params.secret - Webhook signing secret (`whsec_…`)
 * @param params.now - Time to check the timestamp against; defaults to now
 * @returns Parsed and typed {@link WebhookEvent} object
 * @throws {SolvaPayError} If the secret is empty, the signature is missing, malformed, outside the 5-minute
 *   window, or invalid, or the body is not JSON. `error.code` is one of
 *   {@link WEBHOOK_ERROR_CODES}.
 *
 * @example
 * ```typescript
 * // Supabase Edge Function
 * import { verifyWebhook } from '@solvapay/server/edge';
 *
 * const signature = req.headers.get('sv-signature')!;
 * const body = await req.text();
 * const event = await verifyWebhook({ body, signature, secret });
 * ```
 */
export async function verifyWebhook({
  body,
  signature,
  secret,
  now,
}: VerifyWebhookOptions): Promise<WebhookEvent> {
  requireWebhookSecret(secret)
  const parsed = parseWebhookSignature({ body, signature, now })
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(parsed.signedPayload))
  const expectedHmac = Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return finishWebhookVerification(expectedHmac, parsed, body)
}

export { WEBHOOK_ERROR_CODES, WEBHOOK_TOLERANCE_SECONDS } from './webhook-signature'
export type { VerifyWebhookOptions, WebhookErrorCode } from './webhook-signature'
