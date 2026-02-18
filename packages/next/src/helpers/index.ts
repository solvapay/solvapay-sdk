/**
 * Next.js Route Helpers
 *
 * Next.js-specific wrappers for route helpers.
 * These provide NextRequest/NextResponse types and Next.js-specific optimizations.
 */

// Export auth helpers
export { getAuthenticatedUser } from './auth'

// Export customer helpers
export { syncCustomer } from './customer'

// Export payment helpers
export { createPaymentIntent, processPaymentIntent } from './payment'

// Export checkout helpers
export { createCheckoutSession, createCustomerSession } from './checkout'

// Export purchase cancellation helpers
export { cancelRenewal } from './renewal'

// Export plans helpers
export { listPlans } from './plans'

// Export middleware helpers
export { createAuthMiddleware, createSupabaseAuthMiddleware } from './middleware'
export type { AuthMiddlewareOptions, SupabaseAuthMiddlewareOptions } from './middleware'
