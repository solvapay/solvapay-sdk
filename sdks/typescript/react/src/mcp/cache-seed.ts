/**
 * Seed the module-level hook caches (`merchantCache`, `productCache`,
 * `plansCache`, `paymentMethodCache`, `limitsCache`) from a
 * `SolvaPayProviderInitial` snapshot so the MCP App shell never fires a
 * first-mount fetch.
 *
 * Called from `<McpApp>` before rendering `<SolvaPayProvider>`. The
 * seeded entries share the same TTL as normal fetches — once expired
 * the caches fall back to their existing behaviour (which, for MCP,
 * returns the seeded value because the hooks' fetchers become no-ops
 * after the read tools are dropped).
 */

import { merchantCache } from '../hooks/useMerchant'
import { productCache } from '../hooks/useProduct'
import { plansCache } from '../hooks/usePlans'
import { paymentMethodCache } from '../hooks/usePaymentMethod'
import { limitsCache } from '../hooks/useLimits'
import { seedUsageSnapshot } from '../hooks/useUsage'
import { createTransportCacheKey } from '../transport/cache-key'
import type { TransportLimitsResult } from '../transport/types'
import type { LimitResponseWithPlan } from '@solvapay/server'
import type { SolvaPayConfig, SolvaPayProviderInitial } from '../types'

export function toTransportLimits(limits: LimitResponseWithPlan): TransportLimitsResult {
  return {
    withinLimits: limits.withinLimits,
    remaining: limits.remaining,
    meterName: limits.meterName ?? null,
    activationRequired: limits.activationRequired === true,
    ...(limits.throttled !== undefined ? { throttled: limits.throttled } : {}),
    ...(limits.overage !== undefined ? { overage: limits.overage } : {}),
    ...(limits.needsTopUp !== undefined ? { needsTopUp: limits.needsTopUp } : {}),
    ...(limits.needsUpgrade !== undefined ? { needsUpgrade: limits.needsUpgrade } : {}),
    ...(limits.upgraded !== undefined ? { upgraded: limits.upgraded } : {}),
    ...(limits.used !== undefined ? { used: limits.used } : {}),
    ...(limits.limit !== undefined ? { limit: limits.limit } : {}),
  }
}

function limitsCacheKey(
  customerRef: string,
  productRef: string,
  meterName: string,
): string {
  return `${customerRef}:${productRef}:${meterName}`
}

/**
 * Pre-populate the hook caches with the snapshot from the bootstrap
 * payload. The caller passes the live `SolvaPayConfig` (the same object
 * it hands to `<SolvaPayProvider>`) so every cache key is computed with
 * the identical `createTransportCacheKey` logic the hooks use — that way
 * the seeded entries match the keys `useMerchant` / `useProduct` /
 * `usePlans` / `usePaymentMethod` read on first render.
 */
export function seedMcpCaches(initial: SolvaPayProviderInitial, config: SolvaPayConfig): void {
  const now = Date.now()

  const merchantKey = createTransportCacheKey(config, config.api?.getMerchant || '/api/merchant')
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

  seedUsageSnapshot(initial.usage)

  if (initial.limits && initial.customerRef) {
    const meterName = initial.limits.meterName || 'requests'
    limitsCache.set(limitsCacheKey(initial.customerRef, initial.product.reference, meterName), {
      data: toTransportLimits(initial.limits),
      timestamp: now,
      promise: null,
    })
  }
}
