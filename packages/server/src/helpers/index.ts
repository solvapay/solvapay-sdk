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
export { syncCustomerCore } from './customer'

// Export payment helpers
export { createPaymentIntentCore, processPaymentCore } from './payment'

// Export checkout helpers
export { createCheckoutSessionCore, createCustomerSessionCore } from './checkout'

// Export renewal helpers
export { cancelRenewalCore } from './renewal'

// Export plans helpers
export { listPlansCore } from './plans'
