/**
 * Next.js Route Helpers
 *
 * Next.js-specific wrappers for route helpers.
 * These provide NextRequest/NextResponse types and Next.js-specific optimizations.
 */

// Export auth helpers
export { getAuthenticatedUser } from './auth'

// Export customer helpers
export { syncCustomer, getCustomerBalance } from './customer'

// Export payment helpers
export { createPaymentIntent, createTopupPaymentIntent, processPaymentIntent } from './payment'

// Export checkout helpers
export { createCheckoutSession, createCustomerSession } from './checkout'

// Export activation helpers
export { activatePlan } from './activation'

// Export purchase cancellation & reactivation helpers
export { cancelRenewal, reactivateRenewal } from './renewal'

// Export plans helpers
export { listPlans } from './plans'

// Export merchant/product helpers
export { getMerchant } from './merchant'
export { getProduct } from './product'

// Export usage helpers
export { trackUsage } from './usage'

// Export middleware helpers
export { createAuthMiddleware, createSupabaseAuthMiddleware } from './middleware'
export type { AuthMiddlewareOptions, SupabaseAuthMiddlewareOptions } from './middleware'
