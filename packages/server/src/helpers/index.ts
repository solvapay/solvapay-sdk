/**
 * Route Helpers (Core)
 *
 * Generic route helpers that work with standard Web API Request.
 * These can be used by Express, Fastify, Next.js, Edge Functions, etc.
 *
 * Framework-specific wrappers (e.g., Next.js) should be in their respective packages.
 */

// Export types
export type { ErrorResult, AuthenticatedUser } from './types'

// Export error handling
export { isErrorResult, handleRouteError } from './error'

// Export auth helpers
export { getAuthenticatedUserCore } from './auth'

// Export customer helpers
export { syncCustomerCore, getCustomerBalanceCore } from './customer'
export type { CustomerBalanceResult } from './customer'

// Export payment helpers
export {
  createPaymentIntentCore,
  createTopupPaymentIntentCore,
  processPaymentIntentCore,
} from './payment'

// Export checkout helpers
export { createCheckoutSessionCore, createCustomerSessionCore } from './checkout'

// Export purchase cancellation & reactivation helpers
export { cancelPurchaseCore, reactivatePurchaseCore } from './renewal'

// Export activation helpers
export { activatePlanCore } from './activation'

// Export plans helpers
export { listPlansCore } from './plans'

// Export purchase check helpers
export { checkPurchaseCore } from './purchase'
export type { PurchaseCheckResult } from './purchase'

// Export usage tracking helpers
export { trackUsageCore } from './usage'
