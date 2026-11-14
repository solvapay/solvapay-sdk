/**
 * One handler for every route the `@solvapay/react` components call, at the
 * paths they call by default (`/api/check-purchase`, `/api/list-plans`, …):
 *
 * ```ts
 * import { solvapayRoutes } from '@solvapay/server/fetch'
 * const routes = solvapayRoutes()
 * Deno.serve(req => routes(req))
 * ```
 *
 * A path it doesn't serve answers 404; a known path with the wrong method
 * answers 405 with `Allow`. `basePath` moves every route (default `/api`).
 * The webhook route is not included: mount `solvapayWebhook` yourself.
 */
import { handleCors } from './cors'
import {
  activatePlan,
  attachBusinessDetails,
  cancelRenewal,
  checkLimits,
  checkPurchase,
  createCheckoutSession,
  createCustomerSession,
  createPaymentIntent,
  createTopupPaymentIntent,
  customerBalance,
  disableAutoRecharge,
  getAutoRecharge,
  getHistory,
  getMerchant,
  getPaymentMethod,
  getProduct,
  getUsage,
  listPlans,
  processPayment,
  processTopupPayment,
  reactivateRenewal,
  saveAutoRecharge,
  syncCustomer,
  trackUsage,
} from './handlers'
import { errorResponse } from './utils'

type Handler = (req: Request) => Promise<Response>

/** Route name (React's default path without `/api/`) → method → handler. */
export const SOLVAPAY_ROUTES: Readonly<Record<string, Readonly<Partial<Record<string, Handler>>>>> =
  {
    'check-purchase': { GET: checkPurchase },
    'create-payment-intent': { POST: createPaymentIntent },
    'process-payment': { POST: processPayment },
    'create-topup-payment-intent': { POST: createTopupPaymentIntent },
    'process-topup-payment': { POST: processTopupPayment },
    'attach-business-details': { POST: attachBusinessDetails },
    'customer-balance': { GET: customerBalance },
    'cancel-renewal': { POST: cancelRenewal },
    'reactivate-renewal': { POST: reactivateRenewal },
    'activate-plan': { POST: activatePlan },
    'create-checkout-session': { POST: createCheckoutSession },
    'create-customer-session': { POST: createCustomerSession },
    merchant: { GET: getMerchant },
    'get-product': { GET: getProduct },
    'list-plans': { GET: listPlans },
    'payment-method': { GET: getPaymentMethod },
    'auto-recharge': { GET: getAutoRecharge, PUT: saveAutoRecharge, DELETE: disableAutoRecharge },
    usage: { GET: getUsage },
    limits: { GET: checkLimits },
    history: { GET: getHistory },
    'sync-customer': { POST: syncCustomer },
    'track-usage': { POST: trackUsage },
  }

export interface SolvapayRoutesOptions {
  /** Where the routes live; default `/api`. */
  basePath?: string
}

export function solvapayRoutes(options: SolvapayRoutesOptions = {}): Handler {
  const basePath = (options.basePath ?? '/api').replace(/\/+$/, '')
  return async req => {
    const { pathname } = new URL(req.url)
    const name = pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length + 1) : null
    const methods = name !== null ? SOLVAPAY_ROUTES[name] : undefined
    if (!methods) {
      return errorResponse({ error: 'Not found', status: 404 }, req)
    }
    const corsResponse = handleCors(req)
    if (corsResponse) return corsResponse
    const handler = methods[req.method.toUpperCase()]
    if (!handler) {
      const response = errorResponse({ error: 'Method not allowed', status: 405 }, req)
      response.headers.set('Allow', Object.keys(methods).join(', '))
      return response
    }
    return handler(req)
  }
}
