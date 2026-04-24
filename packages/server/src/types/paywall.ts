/**
 * Paywall Type Definitions
 *
 * Types related to paywall protection, limits, and gating functionality.
 */

import type { components } from './generated'

export type LimitPlanSummary = components['schemas']['LimitPlanItemDto']
export type LimitActivationBalance = components['schemas']['LimitBalanceDto']
export type LimitActivationProduct = components['schemas']['LimitProductBriefDto']

/**
 * Arguments passed to protected handlers
 */
export interface PaywallArgs {
  [key: string]: unknown
  auth?: { customer_ref?: string }
}

/**
 * Metadata for configuring paywall protection
 */
export interface PaywallMetadata {
  product?: string
  usageType?: 'requests' | 'tokens'
}

/**
 * Structured content for paywall errors (MCP structuredContent and manual handling).
 */
export type PaywallStructuredContent =
  | {
      kind: 'payment_required'
      /** Product ref from paywall metadata (or env default) */
      product: string
      checkoutUrl: string
      message: string
      /**
       * Quota balance at the moment the paywall tripped. Optional so
       * older server versions (pre-balance-on-payment_required) stay
       * compatible; the React `PaywallNotice.Message` prefers this
       * structured data over the raw `message` when available.
       */
      balance?: LimitActivationBalance
      /** Rich product context from checkLimits (name, ref, provider slug/id) */
      productDetails?: LimitActivationProduct
    }
  | {
      kind: 'activation_required'
      /** Product ref from paywall metadata (or env default) */
      product: string
      message: string
      /**
       * Best URL for completing purchase or confirmation; mirrors confirmationUrl when present.
       */
      checkoutUrl: string
      confirmationUrl?: string
      plans?: LimitPlanSummary[]
      balance?: LimitActivationBalance
      /** Rich product context from checkLimits (name, ref, provider slug/id) */
      productDetails?: LimitActivationProduct
    }

/**
 * MCP tool result with optional paywall information — structural copy
 * of `PaywallToolResult` from `@solvapay/mcp` kept here to avoid a
 * build-time circular dependency between `@solvapay/server` and
 * `@solvapay/mcp`. Keep in lockstep — a snapshot test in
 * `@solvapay/mcp` guards the shape.
 */
export interface PaywallToolResult {
  content?: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
  structuredContent?: PaywallStructuredContent | Record<string, unknown>
  _meta?: Record<string, unknown>
}

/**
 * Runtime type guard for `PaywallStructuredContent`.
 *
 * Used by the MCP registration layer to detect paywall-shaped tool results
 * coming out of `.mcp()` so it knows whether to attach the `_meta.ui`
 * envelope that tells MCP hosts which UI resource to open.
 *
 * @since 1.0.9
 */
export function isPaywallStructuredContent(value: unknown): value is PaywallStructuredContent {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false
  }
  const kind = (value as { kind?: unknown }).kind
  return kind === 'payment_required' || kind === 'activation_required'
}
