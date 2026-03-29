/**
 * SolvaPay Server SDK
 *
 * Main entry point for the SolvaPay server-side SDK.
 * Provides unified payable API with explicit adapters for all frameworks.
 */

import crypto from 'node:crypto'
import { SolvaPayError } from '@solvapay/core'
import type { WebhookEvent } from './types/webhook'

// Main factory for unified API
export { createSolvaPay } from './factory'
export type { CreateSolvaPayConfig, SolvaPay, PayableFunction } from './factory'

// Re-export client creation (for advanced use cases)
export { createSolvaPayClient } from './client'
export type { ServerClientOptions } from './client'

/**
 * Verify webhook signature from SolvaPay backend.
 *
 * The backend sends an `SV-Signature` header in the format `t={timestamp},v1={hmac}`.
 * The HMAC is SHA-256 over `"{timestamp}.{rawBody}"` keyed by the full webhook secret
 * (including the `whsec_` prefix). Signatures older than 5 minutes are rejected to
 * prevent replay attacks.
 *
 * @param params - Webhook verification parameters
 * @param params.body - Raw request body as string (must be exactly as received)
 * @param params.signature - Value of the `SV-Signature` header
 * @param params.secret - Webhook signing secret from SolvaPay dashboard (`whsec_…`)
 * @returns Parsed and typed {@link WebhookEvent} object
 * @throws {SolvaPayError} If signature is missing, malformed, expired, or invalid
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
}: {
  body: string
  signature: string
  secret: string
}): WebhookEvent {
  const toleranceSec = 300
  if (!signature) throw new SolvaPayError('Missing webhook signature')

  const parts = signature.split(',')
  const tPart = parts.find(p => p.startsWith('t='))
  const v1Part = parts.find(p => p.startsWith('v1='))
  if (!tPart || !v1Part) {
    throw new SolvaPayError('Malformed webhook signature')
  }

  const timestamp = parseInt(tPart.slice(2), 10)
  const receivedHmac = v1Part.slice(3)
  if (Number.isNaN(timestamp) || !receivedHmac) {
    throw new SolvaPayError('Malformed webhook signature')
  }

  if (toleranceSec > 0) {
    const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp)
    if (age > toleranceSec) {
      throw new SolvaPayError('Webhook signature timestamp too old')
    }
  }

  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')

  if (receivedHmac.length !== expectedHmac.length) {
    throw new SolvaPayError('Invalid webhook signature')
  }
  const ok = crypto.timingSafeEqual(Buffer.from(expectedHmac), Buffer.from(receivedHmac))
  if (!ok) throw new SolvaPayError('Invalid webhook signature')

  try {
    return JSON.parse(body) as WebhookEvent
  } catch {
    throw new SolvaPayError('Invalid webhook payload: body is not valid JSON')
  }
}

// Export PaywallError for error handling
export { PaywallError } from './paywall'

// Export virtual tools for MCP server monetization
export { createVirtualTools, VIRTUAL_TOOL_DEFINITIONS } from './virtual-tools'
export type { VirtualToolsOptions, VirtualToolDefinition } from './virtual-tools'
export {
  registerVirtualToolsMcpImpl,
  jsonSchemaToZodRawShape,
} from './register-virtual-tools-mcp'
export type { McpServerLike, RegisterVirtualToolsMcpOptions } from './register-virtual-tools-mcp'
export { buildAuthInfoFromBearer } from './mcp/auth-bridge'
export { createMcpOAuthBridge } from './mcp/oauth-bridge'
export {
  getOAuthProtectedResourceResponse,
  getOAuthAuthorizationServerResponse,
} from './mcp/oauth-bridge'

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
  McpToolExtra,
  WebhookEvent,
  WebhookEventType,
} from './types'

// Export payment processing types
export type {
  OneTimePurchaseInfo,
  ProcessPaymentResult,
  CustomerResponseMapped,
  McpBootstrapRequest,
  McpBootstrapResponse,
  McpBootstrapFreePlanConfig,
  McpBootstrapPaidPlanInput,
  ToolPlanMappingInput,
} from './types/client'

// Export utilities for general use
export { withRetry } from './utils'
export {
  McpBearerAuthError,
  extractBearerToken,
  decodeJwtPayload,
  getCustomerRefFromJwtPayload,
  getCustomerRefFromBearerAuthHeader,
} from './mcp-auth'

// Export route helpers (generic, framework-agnostic)
export {
  getAuthenticatedUserCore,
  syncCustomerCore,
  createPaymentIntentCore,
  processPaymentIntentCore,
  createCheckoutSessionCore,
  createCustomerSessionCore,
  cancelPurchaseCore,
  listPlansCore,
  isErrorResult,
  handleRouteError,
} from './helpers'
export type { ErrorResult, AuthenticatedUser } from './helpers'
