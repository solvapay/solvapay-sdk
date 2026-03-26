/**
 * SolvaPay Server SDK - Edge Runtime Entry Point
 *
 * This module provides edge runtime-compatible exports using Web Crypto API.
 * Automatically selected when running in edge runtimes (Vercel Edge, Cloudflare Workers, Deno, etc.)
 */

import { SolvaPayError } from '@solvapay/core'

function parseHexSignature(signature: string): Uint8Array | null {
  const normalizedSignature = signature.trim()
  if (!/^[a-fA-F0-9]{64}$/.test(normalizedSignature)) {
    return null
  }

  const bytes = new Uint8Array(normalizedSignature.length / 2)
  for (let i = 0; i < normalizedSignature.length; i += 2) {
    bytes[i / 2] = Number.parseInt(normalizedSignature.slice(i, i + 2), 16)
  }

  return bytes
}

function constantTimeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }

  let mismatch = 0
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left[i] ^ right[i]
  }

  return mismatch === 0
}

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
  const computedSignature = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)))
  const providedSignature = parseHexSignature(signature)

  if (!providedSignature || !constantTimeEqualBytes(computedSignature, providedSignature)) {
    throw new SolvaPayError('Invalid webhook signature')
  }

  return JSON.parse(body)
}
