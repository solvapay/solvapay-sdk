/**
 * SolvaPay Server SDK
 * 
 * Main entry point for the SolvaPay server-side SDK.
 * Provides unified payable API with explicit adapters for all frameworks.
 */

import crypto from "node:crypto";
import { SolvaPayError } from "@solvapay/core";

// Main factory for unified API
export { createSolvaPay } from './factory';
export type { 
  CreateSolvaPayConfig, 
  SolvaPay, 
  PayableFunction 
} from './factory';

// Re-export client creation (for advanced use cases)
export { createSolvaPayClient } from './client';
export type { ServerClientOptions } from './client';

// Webhook verification
export function verifyWebhook({ body, signature, secret }: { body: string; signature: string; secret: string }) {
  const hmac = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const ok = crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  if (!ok) throw new SolvaPayError("Invalid webhook signature");
  return JSON.parse(body);
}

// Export PaywallError for error handling
export { PaywallError } from './paywall';

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
  RetryOptions
} from './types';

// Export payment processing types
export type {
  PurchaseInfo,
  ProcessPaymentResult
} from './types/client';

// Export utilities for general use
export { withRetry } from './utils';
