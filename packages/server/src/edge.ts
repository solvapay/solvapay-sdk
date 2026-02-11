/**
 * SolvaPay Server SDK - Edge Runtime Entry Point
 *
 * This module provides edge runtime-compatible exports using Web Crypto API.
 * Automatically selected when running in edge runtimes (Vercel Edge, Cloudflare Workers, Deno, etc.)
 */

import { SolvaPayError } from '@solvapay/core'

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
} from './types'

// Export retry utility for general use
export { withRetry } from './utils'

// Export route helpers (generic, framework-agnostic)
// These work in edge runtimes as they use standard Web API Request
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

/**
 * Verify webhook signature using edge-compatible Web Crypto API
 * Works in: Vercel Edge Functions, Cloudflare Workers, Deno, Supabase Edge Functions
 *
 * @param body - The raw webhook request body (string)
 * @param signature - The signature from x-solvapay-signature header
 * @param secret - Your webhook secret key
 * @returns Parsed webhook event object
 * @throws {SolvaPayError} If signature verification fails
 *
 * @example
 * ```typescript
 * // Supabase Edge Function
 * import { verifyWebhook } from '@solvapay/server';
 *
 * const signature = req.headers.get('x-solvapay-signature');
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
}) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const hex = Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  if (hex !== signature) {
    throw new SolvaPayError('Invalid webhook signature')
  }

  return JSON.parse(body)
}
