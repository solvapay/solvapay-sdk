/**
 * Paywall Type Definitions
 *
 * Types related to paywall protection, limits, and gating functionality.
 */

import type { components } from './generated'

export type LimitPlanSummary = components['schemas']['LimitPlanSummary']
export type LimitActivationBalance = components['schemas']['LimitActivationBalance']
export type LimitActivationProduct = components['schemas']['LimitActivationProduct']

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
  plan?: string
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
 * MCP tool result with optional paywall information
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
}
