import type { AutoRechargeConfig } from '@solvapay/server'
import type { SolvaPayConfig } from '../types'
import { createTransportCacheKey } from '../transport/cache-key'

type AutoRechargeCacheEntry = {
  config: AutoRechargeConfig | null
  promise: Promise<AutoRechargeConfig | null> | null
  timestamp: number
}

const autoRechargeCache = new Map<string, AutoRechargeCacheEntry>()
const CACHE_DURATION = 5 * 60 * 1000

function autoRechargeCacheKeyFor(config: SolvaPayConfig | undefined): string {
  return createTransportCacheKey(config, config?.api?.getAutoRecharge || '/api/auto-recharge')
}

/** @internal Exported only for tests and provider balance reconciliation. */
export { autoRechargeCache, CACHE_DURATION, autoRechargeCacheKeyFor }
