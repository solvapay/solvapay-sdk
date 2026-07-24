/**
 * SolvaPay Server SDK - Edge Runtime Entry Point
 *
 * This module provides edge runtime-compatible exports. Webhook verification
 * routes exclusively through the wasm-bindgen binding (`@solvapay/server-wasm`);
 * there is no Web Crypto rollback. Automatically selected when running in edge
 * runtimes (Vercel Edge, Cloudflare Workers, Deno, etc.)
 */

import { installNativeCoreApi, SolvaPayError } from '@solvapay/core'
import type { WebhookEvent } from './types/webhook'
import { installMcpAdapterNative } from './adapters/mcp'
import { installNativeDecisionApi } from './native-decisions'
import type { PaywallStructuredContent, PaywallToolResult } from './types'
import {
  callWasmSync,
  publishWasmSyncApi,
  resolveEdgeImpl,
  resolveEdgeWebhookImpl,
  verifyWebhookWasm,
  warmWasm,
} from './wasm'

// Install WASM sync dispatch for the edge graph (Deno / Workers / edge-light).
// The install is the gate. After Step 53, `SOLVAPAY_IMPL=ts` makes
// `resolveEdgeImpl` return `ts` and every sync/async surface fail fast —
// there is no TypeScript semantic path. Node never loads this module (it
// installs napi dispatch via `index.ts`).
installNativeDecisionApi({ callNativeSync: callWasmSync, resolveImpl: resolveEdgeImpl })
// Step 52: @solvapay/core is Rust-only — SOLVAPAY_IMPL=ts does not gate it.
installNativeCoreApi({ callNativeSync: callWasmSync, resolveImpl: () => 'rust' })
installMcpAdapterNative({
  formatGate: (gate: PaywallStructuredContent): PaywallToolResult | null => {
    if (resolveEdgeImpl('mcp') !== 'rust') return null
    return callWasmSync(
      'paywallToolResult',
      JSON.stringify({ message: gate.message, structuredContent: gate }),
    ) as PaywallToolResult
  },
})
// Ambient registry for mcp-core (Deno resolves it to the edge graph too).
publishWasmSyncApi()
// Warm the module so sync surfaces can synchronously init on first use.
warmWasm()

// Re-export the main client which is already edge-compatible (uses fetch)
export { createSolvaPayClient } from './client'
export type { ServerClientOptions } from './client'

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
export { buildGateMessage, buildNudgeMessage, classifyPaywallState } from './paywall-state'
export { buildPaywallGate } from './paywall-gate'
export type { PaywallState } from './paywall-state'
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
  listPlansCore,
  checkLimitsCore,
  getMerchantCore,
  getProductCore,
  getPaymentMethodCore,
  getAutoRechargeCore,
  saveAutoRechargeCore,
  disableAutoRechargeCore,
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
 * Verify webhook signature (async edge facade).
 *
 * Routes through the Rust WASM binding (`solvapay_core::verify_webhook`).
 * Rust-only after Step 53 — `SOLVAPAY_IMPL=ts` fails fast rather than running a
 * duplicate Web Crypto implementation.
 *
 * The backend sends an `SV-Signature` header in the format `t={timestamp},v1={hmac}`.
 * The HMAC is SHA-256 over `"{timestamp}.{rawBody}"` keyed by the full webhook secret
 * (including the `whsec_` prefix). Signatures older than 5 minutes are rejected to
 * prevent replay attacks.
 *
 * Works in: Vercel Edge Functions, Cloudflare Workers, Deno, Supabase Edge Functions.
 *
 * @param params.body - Raw webhook request body (string)
 * @param params.signature - Value of the `SV-Signature` header
 * @param params.secret - Webhook signing secret (`whsec_…`)
 * @returns Parsed and typed {@link WebhookEvent} object
 * @throws {SolvaPayError} If signature is missing, malformed, expired, or invalid
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
}: {
  body: string
  signature: string
  secret: string
}): Promise<WebhookEvent> {
  // Rust-only after Step 53. `SOLVAPAY_IMPL=ts` fails fast instead of running a
  // duplicate Web Crypto implementation on the edge.
  if (resolveEdgeWebhookImpl() !== 'rust') {
    throw new SolvaPayError('server webhook API not installed')
  }
  return verifyWebhookWasm({ body, signature, secret })
}
