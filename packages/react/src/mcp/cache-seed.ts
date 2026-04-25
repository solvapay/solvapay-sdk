/**
 * Seed the module-level hook caches (`merchantCache`, `productCache`,
 * `plansCache`, `paymentMethodCache`) from a `SolvaPayProviderInitial`
 * snapshot so the MCP App shell never fires a first-mount fetch.
 *
 * Called from `<McpApp>` before rendering `<SolvaPayProvider>`. The
 * seeded entries share the same 5-minute TTL as normal fetches — once
 * expired the caches fall back to their existing behaviour (which, for
 * MCP, returns the seeded value because the hooks' fetchers become
 * no-ops after the read tools are dropped).
 */

import { merchantCache } from '../hooks/useMerchant'
import { productCache } from '../hooks/useProduct'
import { plansCache } from '../hooks/usePlans'
import { paymentMethodCache } from '../hooks/usePaymentMethod'
import { createTransportCacheKey } from '../transport/cache-key'
import type { SolvaPayConfig, SolvaPayProviderInitial } from '../types'

/**
 * Pre-populate the hook caches with the snapshot from the bootstrap
 * payload. The caller passes the live `SolvaPayConfig` (the same object
 * it hands to `<SolvaPayProvider>`) so every cache key is computed with
 * the identical `createTransportCacheKey` logic the hooks use — that way
 * the seeded entries match the keys `useMerchant` / `useProduct` /
 * `usePlans` / `usePaymentMethod` read on first render.
 */
export function seedMcpCaches(
  initial: SolvaPayProviderInitial,
  config: SolvaPayConfig,
): void {
  const now = Date.now()

  const merchantKey = createTransportCacheKey(
    config,
    config.api?.getMerchant || '/api/merchant',
  )
  merchantCache.set(merchantKey, {
    merchant: initial.merchant,
    promise: null,
    timestamp: now,
  })

  const productKey = createTransportCacheKey(
    config,
    initial.product.reference,
    initial.product.reference,
  )
  productCache.set(productKey, {
    product: initial.product,
    promise: null,
    timestamp: now,
  })

  // usePlans cache is keyed by raw productRef (no transport scoping) —
  // the hook predates the transport cache-key helper.
  plansCache.set(initial.product.reference, {
    plans: initial.plans,
    promise: null,
    timestamp: now,
  })

  if (initial.paymentMethod && initial.customerRef) {
    const paymentMethodKey = createTransportCacheKey(
      config,
      config.api?.getPaymentMethod || '/api/payment-method',
    )
    paymentMethodCache.set(paymentMethodKey, {
      paymentMethod: initial.paymentMethod,
      promise: null,
      timestamp: now,
    })
  }
}
