import { BALANCE_RECONCILE_DELAYS_MS } from '@solvapay/server'
import type { SolvaPayConfig } from '../types'
import { autoRechargeCache, autoRechargeCacheKeyFor } from '../hooks/autoRechargeCache'

export function getActiveAutoRechargeThreshold(config: SolvaPayConfig | undefined): number | null {
  const key = autoRechargeCacheKeyFor(config)
  const cached = autoRechargeCache.get(key)?.config
  if (cached?.enabled && cached.status === 'active') {
    return cached.trigger.thresholdCredits
  }
  return null
}

export const BALANCE_RECONCILE_GRACE_MS =
  BALANCE_RECONCILE_DELAYS_MS.reduce((sum, delay) => sum + delay, 0) + 1000
