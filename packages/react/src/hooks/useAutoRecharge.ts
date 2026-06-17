import { useCallback, useEffect, useState } from 'react'
import type {
  AutoRechargeConfig,
  AutoRechargeInput,
  SaveAutoRechargeResponse,
} from '@solvapay/server'
import { useSolvaPay } from './useSolvaPay'
import { createHttpTransport } from '../transport/http'
import { createTransportCacheKey } from '../transport/cache-key'
import type { SolvaPayConfig } from '../types'

type CacheEntry = {
  config: AutoRechargeConfig | null
  promise: Promise<AutoRechargeConfig | null> | null
  timestamp: number
}

export type UseAutoRechargeReturn = {
  config: AutoRechargeConfig | null
  loading: boolean
  saving: boolean
  disabling: boolean
  error: Error | null
  refresh: (force?: boolean) => Promise<void>
  save: (input: AutoRechargeInput) => Promise<SaveAutoRechargeResponse>
  disable: () => Promise<{ success: true }>
}

const autoRechargeCache = new Map<string, CacheEntry>()
const CACHE_DURATION = 5 * 60 * 1000

/** @internal Exported only for tests. */
export { autoRechargeCache, CACHE_DURATION }

function cacheKeyFor(config: SolvaPayConfig | undefined): string {
  return createTransportCacheKey(config, config?.api?.getAutoRecharge || '/api/auto-recharge')
}

async function fetchAutoRecharge(
  config: SolvaPayConfig | undefined,
): Promise<AutoRechargeConfig | null> {
  const transport = config?.transport ?? createHttpTransport(config)
  if (!transport.getAutoRecharge) return null
  const response = await transport.getAutoRecharge()
  return response.config
}

export function useAutoRecharge(): UseAutoRechargeReturn {
  const { _config } = useSolvaPay()
  const key = cacheKeyFor(_config)

  const [config, setConfig] = useState<AutoRechargeConfig | null>(
    () => autoRechargeCache.get(key)?.config ?? null,
  )
  const [loading, setLoading] = useState(() => {
    const cached = autoRechargeCache.get(key)
    return !cached || (!cached.config && !cached.promise)
  })
  const [saving, setSaving] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(
    async (force = false) => {
      const cached = autoRechargeCache.get(key)
      const now = Date.now()

      if (!force && cached?.config && now - cached.timestamp < CACHE_DURATION) {
        setConfig(cached.config)
        setLoading(false)
        setError(null)
        return
      }

      if (!force && cached?.promise) {
        setLoading(true)
        try {
          const value = await cached.promise
          setConfig(value)
          setError(null)
        } catch (caught) {
          setError(caught instanceof Error ? caught : new Error(String(caught)))
        } finally {
          setLoading(false)
        }
        return
      }

      setLoading(true)
      setError(null)
      const promise = fetchAutoRecharge(_config)
      autoRechargeCache.set(key, {
        config: cached?.config ?? null,
        promise,
        timestamp: now,
      })

      try {
        const value = await promise
        autoRechargeCache.set(key, { config: value, promise: null, timestamp: Date.now() })
        setConfig(value)
      } catch (caught) {
        const err = caught instanceof Error ? caught : new Error(String(caught))
        autoRechargeCache.set(key, { config: null, promise: null, timestamp: Date.now() })
        setError(err)
      } finally {
        setLoading(false)
      }
    },
    [_config, key],
  )

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(
    async (force = true) => {
      await load(force)
    },
    [load],
  )

  const save = useCallback(
    async (input: AutoRechargeInput) => {
      const transport = _config?.transport ?? createHttpTransport(_config)
      if (!transport.saveAutoRecharge) {
        throw new Error('saveAutoRecharge is not available on this transport')
      }
      setSaving(true)
      setError(null)
      try {
        const result = await transport.saveAutoRecharge(input)
        autoRechargeCache.set(key, {
          config: result.config,
          promise: null,
          timestamp: Date.now(),
        })
        setConfig(result.config)
        return result
      } catch (caught) {
        const err = caught instanceof Error ? caught : new Error(String(caught))
        setError(err)
        throw err
      } finally {
        setSaving(false)
      }
    },
    [_config, key],
  )

  const disable = useCallback(async () => {
    const transport = _config?.transport ?? createHttpTransport(_config)
    if (!transport.disableAutoRecharge) {
      throw new Error('disableAutoRecharge is not available on this transport')
    }
    setDisabling(true)
    setError(null)
    try {
      const result = await transport.disableAutoRecharge()
      await refresh(true)
      return result
    } catch (caught) {
      const err = caught instanceof Error ? caught : new Error(String(caught))
      setError(err)
      throw err
    } finally {
      setDisabling(false)
    }
  }, [_config, refresh])

  return { config, loading, saving, disabling, error, refresh, save, disable }
}
