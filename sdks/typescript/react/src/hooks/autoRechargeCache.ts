import type { AutoRechargeConfig } from '@solvapay/server'
import type { SolvaPayConfig } from '../types'
import { createTransportCacheKey } from '../transport/cache-key'

type AutoRechargeCacheEntry = {
  config: AutoRechargeConfig | null
  promise: Promise<AutoRechargeConfig | null> | null
  timestamp: number
}

const autoRechargeCache = new Map<string, AutoRechargeCacheEntry>()
const listeners = new Map<string, Set<() => void>>()
const CACHE_DURATION = 5 * 60 * 1000

function autoRechargeCacheKeyFor(config: SolvaPayConfig | undefined): string {
  return createTransportCacheKey(config, config?.api?.autoRecharge || '/api/auto-recharge')
}

function notifyAutoRechargeListeners(key: string): void {
  listeners.get(key)?.forEach(listener => listener())
}

/** @internal Writes cache entry and notifies subscribers. */
function writeAutoRechargeCache(key: string, entry: AutoRechargeCacheEntry): void {
  autoRechargeCache.set(key, entry)
  notifyAutoRechargeListeners(key)
}

/** @internal Subscribe to cache changes for a key. Returns an unsubscribe function. */
function subscribeAutoRecharge(key: string, listener: () => void): () => void {
  let keyListeners = listeners.get(key)
  if (!keyListeners) {
    keyListeners = new Set()
    listeners.set(key, keyListeners)
  }
  keyListeners.add(listener)
  return () => {
    keyListeners?.delete(listener)
    if (keyListeners?.size === 0) {
      listeners.delete(key)
    }
  }
}

/** @internal Deletes cache entry and notifies subscribers so mounted hooks re-fetch. */
function invalidateAutoRecharge(key: string): void {
  autoRechargeCache.delete(key)
  notifyAutoRechargeListeners(key)
}

/** @internal Exported for tests and provider balance reconciliation invalidation. */
export {
  autoRechargeCache,
  CACHE_DURATION,
  autoRechargeCacheKeyFor,
  writeAutoRechargeCache,
  subscribeAutoRecharge,
  invalidateAutoRecharge,
}
