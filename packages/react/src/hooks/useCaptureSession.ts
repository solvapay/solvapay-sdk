'use client'

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import { UnsupportedTransportMethodError } from '../transport'
import { CaptureError, type CaptureSession } from '../vault/types'

/** How far ahead of expiry a fresh grant is minted. */
const RENEW_LEAD_MS = 30_000

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

  // Mint once, when there is nothing to use.
  //
  // This deliberately does NOT re-mint whenever the current session is
  // unusable. That version spun: an expired grant fails `isSessionUsable`, so
  // the effect mints, the new grant is stored, the effect runs again, and if
  // that grant is also unusable — clock skew, or a server TTL below our own
  // slack — it mints again, forever, hammering the endpoint that hands out
  // write credentials. Renewal is a timer below, not a reaction to state.
  useEffect(() => {
    if (!enabled) return
    if (session) return
    void refresh()
  }, [enabled, session, refresh])

  // Re-mint shortly before expiry, so a capture never starts on a grant that
  // dies mid-submit. A session that is already inside the lead window is left
  // alone: `save` then fails loudly with `session_expired`, which is the right
  // outcome and cannot loop.
  useEffect(() => {
    if (!enabled || !session) return
    const delay = session.expiresAt - Date.now() - RENEW_LEAD_MS
    if (delay <= 0) return
    const timer = setTimeout(() => void refresh(), delay)
    return () => clearTimeout(timer)
  }, [enabled, session, refresh])

  return { session, loading, error, refresh }
}
