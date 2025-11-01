/**
 * Paywall Type Definitions
 * 
 * Types related to paywall protection, limits, and gating functionality.
 */

/**
 * Arguments passed to protected handlers
 */
export interface PaywallArgs {
  [key: string]: any;
  auth?: { customer_ref?: string };
}

/**
 * Metadata for configuring paywall protection
 */
export interface PaywallMetadata {
  agent?: string;
  plan?: string; // Optional plan identifier, defaults to handler/action name
}

/**
 * Structured content for paywall errors
 */
export interface PaywallStructuredContent {
  kind: 'payment_required';
  agent: string;
  checkoutUrl: string;
  message: string;
}

/**
 * MCP tool result with optional paywall information
 */
export interface PaywallToolResult {
  content?: Array<{ type: 'text' | 'image' | 'resource'; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
  structuredContent?: PaywallStructuredContent;
}

