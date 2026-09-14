'use client'

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import { UnsupportedTransportMethodError } from '../transport'
import { CaptureError, isSessionUsable, type CaptureSession } from '../vault/types'

export interface UseCaptureSessionOptions {
  productRef?: string
  planRef?: string
  /** Set false to hold off minting until the surface is actually shown. */
  enabled?: boolean
}

export interface UseCaptureSessionResult {
  session: CaptureSession | null
  loading: boolean
  error: CaptureError | null
  /** Mints a fresh session. Safe to call when the current one is near expiry. */
  refresh: () => Promise<CaptureSession | null>
}

/**
 * Mints the short-lived grant the vault capture surface needs.
 *
 * The token is write-only and expires quickly, so it is refreshed rather than
 * cached across a session. A capture that starts with a token about to expire
 * fails at submit, which is the worst possible moment, so the surface
 * re-mints ahead of expiry rather than discovering it late.
 */
export function useCaptureSession(options: UseCaptureSessionOptions = {}): UseCaptureSessionResult {
  const { productRef, planRef, enabled = true } = options
  const ctx = useContext(SolvaPayContext)
  if (!ctx) throw new MissingProviderError('useCaptureSession')

  const [session, setSession] = useState<CaptureSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<CaptureError | null>(null)
  const inFlight = useRef<Promise<CaptureSession | null> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async (): Promise<CaptureSession | null> => {
    if (inFlight.current) return inFlight.current

    const run = (async () => {
      setLoading(true)
      setError(null)
      try {
        const transport = ctx._config?.transport
        const create = transport?.createCaptureSession
        if (!create) {
          throw new UnsupportedTransportMethodError('createCaptureSession')
        }
        const result = await create({
          ...(productRef ? { productRef } : {}),
          ...(planRef ? { planRef } : {}),
          ...(ctx.customerRef ? { customerRef: ctx.customerRef } : {}),
        })
        const next: CaptureSession = {
          token: result.token,
          tenantId: result.tenantId,
          environment: result.environment,
          expiresAt: result.expiresAt,
          captureSessionId: result.captureSessionId,
        }
        if (mounted.current) setSession(next)
        return next
      } catch (err) {
        const captureError =
          err instanceof CaptureError
            ? err
            : new CaptureError(
                'vault_error',
                err instanceof Error ? err.message : 'Could not start the card capture session.',
              )
        if (mounted.current) setError(captureError)
        return null
      } finally {
        if (mounted.current) setLoading(false)
        inFlight.current = null
      }
    })()

    inFlight.current = run
    return run
  }, [ctx, productRef, planRef])

  useEffect(() => {
    if (!enabled) return
    if (session && isSessionUsable(session)) return
    void refresh()
  }, [enabled, session, refresh])

  return { session, loading, error, refresh }
}
