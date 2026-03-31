/**
 * SolvaPay Server SDK - Edge Runtime Entry Point
 *
 * This module provides edge runtime-compatible exports using Web Crypto API.
 * Automatically selected when running in edge runtimes (Vercel Edge, Cloudflare Workers, Deno, etc.)
 */

import { SolvaPayError } from '@solvapay/core'
import type { WebhookEvent } from './types/webhook'

// Re-export the main client which is already edge-compatible (uses fetch)
export { createSolvaPayClient } from './client'
export type { ServerClientOptions } from './client'

// Re-export factory for unified API
export { createSolvaPay } from './factory'
export type { CreateSolvaPayConfig, SolvaPay, PayableFunction } from './factory'

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
  WebhookEvent,
  WebhookEventType,
  WebhookEventForType,
  WebhookEventObjectMap,
  CustomerWebhookObject,
  WebhookProduct,
} from './types'

// Export retry utility for general use
export { withRetry } from './utils'

// Export route helpers (generic, framework-agnostic)
// These work in edge runtimes as they use standard Web API Request
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

/**
 * Verify webhook signature using edge-compatible Web Crypto API.
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
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

export async function verifyWebhook({
  body,
  signature,
  secret,
}: {
  body: string
  signature: string
  secret: string
}): Promise<WebhookEvent> {
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

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${body}`))
  const expectedHmac = Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  if (!timingSafeEqual(expectedHmac, receivedHmac)) {
    throw new SolvaPayError('Invalid webhook signature')
  }

  try {
    return JSON.parse(body) as WebhookEvent
  } catch {
    throw new SolvaPayError('Invalid webhook payload: body is not valid JSON')
  }
}
