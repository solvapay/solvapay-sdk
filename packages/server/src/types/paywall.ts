/**
 * Paywall Type Definitions
 *
 * Types related to paywall protection, limits, and gating functionality.
 */

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
}

/**
 * Structured content for paywall errors
 */
export interface PaywallStructuredContent {
  kind: 'payment_required'
  product: string
  checkoutUrl: string
  message: string
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
  structuredContent?: PaywallStructuredContent
}
