/**
 * SolvaPay Server SDK
 *
 * Main entry point for the SolvaPay server-side SDK.
 * Provides unified payable API with explicit adapters for all frameworks.
 */

import crypto from 'node:crypto'
import { SolvaPayError } from '@solvapay/core'

// Main factory for unified API
export { createSolvaPay } from './factory'
export type { CreateSolvaPayConfig, SolvaPay, PayableFunction } from './factory'

// Re-export client creation (for advanced use cases)
export { createSolvaPayClient } from './client'
export type { ServerClientOptions } from './client'

/**
 * Verify webhook signature from SolvaPay backend.
 *
 * This function verifies that a webhook request is authentic by comparing
 * the provided signature with a computed HMAC-SHA256 signature of the request body.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param params - Webhook verification parameters
 * @param params.body - Raw request body as string (must be exactly as received)
 * @param params.signature - Signature from `x-solvapay-signature` header
 * @param params.secret - Webhook secret from SolvaPay dashboard
 * @returns Parsed webhook payload as object
 * @throws {SolvaPayError} If signature is invalid
 *
 * @example
 * ```typescript
 * import { verifyWebhook } from '@solvapay/server';
 *
 * // In Express.js
 * app.post('/webhooks/solvapay', express.raw({ type: 'application/json' }), (req, res) => {
 *   try {
 *     const signature = req.headers['x-solvapay-signature'] as string;
 *     const payload = verifyWebhook({
 *       body: req.body.toString(),
 *       signature,
 *       secret: process.env.SOLVAPAY_WEBHOOK_SECRET!
 *     });
 *
 *     // Handle webhook event
 *     if (payload.type === 'subscription.created') {
 *       // Process subscription creation
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
}: {
  body: string
  signature: string
  secret: string
}) {
  const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex')
  const ok = crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature))
  if (!ok) throw new SolvaPayError('Invalid webhook signature')
  return JSON.parse(body)
}

// Export PaywallError for error handling
export { PaywallError } from './paywall'

// Export types
export type {
  SolvaPayClient,
  PayableOptions,
  HttpAdapterOptions,
  NextAdapterOptions,
  McpAdapterOptions,
  PaywallArgs,
  PaywallMetadata,
  PaywallStructuredContent,
  PaywallToolResult,
  RetryOptions,
} from './types'

// Export payment processing types
export type { PurchaseInfo, ProcessPaymentResult, CustomerResponseMapped } from './types/client'

// Export utilities for general use
export { withRetry } from './utils'

// Export route helpers (generic, framework-agnostic)
export {
  getAuthenticatedUserCore,
  syncCustomerCore,
  createPaymentIntentCore,
  processPaymentCore,
  createCheckoutSessionCore,
  createCustomerSessionCore,
  cancelRenewalCore,
  listPlansCore,
  isErrorResult,
  handleRouteError,
} from './helpers'
export type { ErrorResult, AuthenticatedUser } from './helpers'
