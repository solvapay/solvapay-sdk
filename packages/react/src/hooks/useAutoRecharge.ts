import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AutoRechargeConfig,
  SaveAutoRechargeInput,
  SaveAutoRechargeResponse,
} from '@solvapay/server'
import { useSolvaPay } from './useSolvaPay'
import { createHttpTransport } from '../transport/http'
import type { SolvaPayConfig } from '../types'
import { autoRechargeCache, autoRechargeCacheKeyFor, CACHE_DURATION, subscribeAutoRecharge, writeAutoRechargeCache } from './autoRechargeCache'

export type UseAutoRechargeReturn = {
  config: AutoRechargeConfig | null
  loading: boolean
  saving: boolean
  disabling: boolean
  error: Error | null
  refresh: (force?: boolean) => Promise<void>
  save: (input: SaveAutoRechargeInput) => Promise<SaveAutoRechargeResponse>
  disable: () => Promise<{ success: true }>
}

/** @internal Exported only for tests. */
export { autoRechargeCache, CACHE_DURATION }

function mergeAutoRechargeConfig(
  config: AutoRechargeConfig,
  display?: AutoRechargeConfig['display'],
): AutoRechargeConfig {
  return display ? { ...config, display } : config
}

async function fetchAutoRecharge(
  config: SolvaPayConfig | undefined,
): Promise<AutoRechargeConfig | null> {
  const transport = config?.transport ?? createHttpTransport(config)
  if (!transport.getAutoRecharge) return null
  const response = await transport.getAutoRecharge()
  if (!response.config) return null
  return mergeAutoRechargeConfig(response.config, response.display)
}

export function useAutoRecharge(): UseAutoRechargeReturn {
  const { _config } = useSolvaPay()
  const key = autoRechargeCacheKeyFor(_config)

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
  const requestSeq = useRef(0)

  const load = useCallback(
    async (force = false) => {
      const seq = requestSeq.current
      const cached = autoRechargeCache.get(key)
      const now = Date.now()

      if (!force && cached?.config && now - cached.timestamp < CACHE_DURATION) {
        if (seq !== requestSeq.current) return
        setConfig(cached.config)
        setLoading(false)
        setError(null)
        return
      }

      if (!force && cached?.promise) {
        setLoading(true)
        try {
          const value = await cached.promise
          if (seq !== requestSeq.current) return
          setConfig(value)
          setError(null)
        } catch (caught) {
          if (seq !== requestSeq.current) return
          setError(caught instanceof Error ? caught : new Error(String(caught)))
        } finally {
          if (seq === requestSeq.current) {
            setLoading(false)
          }
        }
        return
      }

      setLoading(true)
      setError(null)
      const promise = fetchAutoRecharge(_config)
      writeAutoRechargeCache(key, {
        config: cached?.config ?? null,
        promise,
        timestamp: now,
      })

      try {
        const value = await promise
        if (seq !== requestSeq.current) return
        writeAutoRechargeCache(key, { config: value, promise: null, timestamp: Date.now() })
        setConfig(value)
      } catch (caught) {
        if (seq !== requestSeq.current) return
        const err = caught instanceof Error ? caught : new Error(String(caught))
        writeAutoRechargeCache(key, {
          config: cached?.config ?? null,
          promise: null,
          timestamp: Date.now(),
        })
        setError(err)
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false)
        }
      }
    },
    [_config, key],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    return subscribeAutoRecharge(key, () => {
      const cached = autoRechargeCache.get(key)
      if (cached) {
        setConfig(cached.config)
        return
      }
      void load(true)
    })
  }, [key, load])

  const refresh = useCallback(
    async (force = true) => {
      await load(force)
    },
    [load],
  )

  const save = useCallback(
    async (input: SaveAutoRechargeInput) => {
      const transport = _config?.transport ?? createHttpTransport(_config)
      if (!transport.saveAutoRecharge) {
        throw new Error('saveAutoRecharge is not available on this transport')
      }
      setSaving(true)
      setError(null)
      const seq = ++requestSeq.current
      try {
        const result = await transport.saveAutoRecharge(input)
        if (seq !== requestSeq.current) return result
        const nextConfig = mergeAutoRechargeConfig(result.config, result.display)
        writeAutoRechargeCache(key, {
          config: nextConfig,
          promise: null,
          timestamp: Date.now(),
        })
        setConfig(nextConfig)
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
    const seq = ++requestSeq.current
    try {
      const result = await transport.disableAutoRecharge()
      if (seq === requestSeq.current) {
        setConfig(current => {
          const disabledConfig = current ? { ...current, enabled: false } : null
          writeAutoRechargeCache(key, {
            config: disabledConfig,
            promise: null,
            timestamp: Date.now(),
          })
          return disabledConfig
        })
        await refresh(true)
        setConfig(current => {
          const disabledConfig = current ? { ...current, enabled: false } : null
          writeAutoRechargeCache(key, {
            config: disabledConfig,
            promise: null,
            timestamp: Date.now(),
          })
          return disabledConfig
        })
      }
      return result
    } catch (caught) {
      const err = caught instanceof Error ? caught : new Error(String(caught))
      setError(err)
      throw err
    } finally {
      setDisabling(false)
    }
  }, [_config, key, refresh])

  return { config, loading, saving, disabling, error, refresh, save, disable }
}
