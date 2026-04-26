/**
 * `@solvapay/server/fetch` — Web-standards `(req: Request) => Promise<Response>`
 * handlers for every SolvaPay route, plus `configureCors` and the
 * `solvapayWebhook` factory. Drops into `Deno.serve`, Cloudflare
 * Workers' `fetch` export, Bun, Next.js Edge, Vercel Functions, and
 * any other runtime that speaks Web-standards Request / Response.
 *
 * Formerly shipped as standalone package `@solvapay/fetch` (renamed
 * from `@solvapay/supabase@1.0.1`). Folded into `@solvapay/server` as
 * a subpath export in `@solvapay/server@1.0.8` so the Web-standards
 * wrappers live alongside the `*Core` helpers they wrap — no peer-
 * dependency tangle, no self-imports.
 *
 * @example
 * ```ts
 * // supabase/functions/check-purchase/index.ts
 * import { checkPurchase } from '@solvapay/server/fetch'
 *
 * Deno.serve(checkPurchase)
 * ```
 */

export {
  activatePlan,
  cancelRenewal,
  checkPurchase,
  createCheckoutSession,
  createCustomerSession,
  createPaymentIntent,
  createTopupPaymentIntent,
  customerBalance,
  getMerchant,
  getPaymentMethod,
  getProduct,
  listPlans,
  processPayment,
  reactivateRenewal,
  solvapayWebhook,
  syncCustomer,
  trackUsage,
} from './handlers'
export type { SolvapayWebhookOptions } from './handlers'

export { configureCors } from './cors'
