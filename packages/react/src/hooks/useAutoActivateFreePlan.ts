'use client'

/**
 * `useAutoActivateFreePlan` — silently activates the product's free plan
 * when the backend reports `activationRequired: true`.
 *
 * Primary enrollment for free + non-usage-based default plans now happens
 * server-side: the first `checkLimits` call auto-creates a Purchase with
 * `origin: 'free_default'`. This hook remains a defensive fallback for
 * paid-default products that expose a free fallback plan, for hosts that
 * skip the limits pre-check, or when auto-enrollment fails transiently.
 *
 * Use the returned `pending` flag as a skeleton gate so the UI doesn't
 * commit to "0 left" between the limits fetch and the post-activation
 * refetch.
 *
 * When the product has no free plan to activate (e.g. a PAYG-only
 * product whose default plan needs activation but is paid), `pending`
 * stays `false` — the consumer commits to the backend's actual
 * `remaining` (typically `0 left` + an upgrade CTA) instead of stalling
 * on a skeleton that would never resolve.
 *
 * Internally pairs `useLimits` (for `activationRequired` + the
 * post-activate refetch), `usePlans` (to find the free plan), and
 * `useActivation` (the activation state machine). A one-shot guard
 * keyed by `${customerRef}:${productRef}` prevents loops on activation
 * failure; identity / scenario switches re-arm because the key
 * changes.
 *
 * @example
 * ```tsx
 * const { pending: autoActivating } = useAutoActivateFreePlan({ productRef })
 *
 * <UsagePill
 *   loading={autoActivating || limitsLoading}
 *   remaining={limitRemaining}
 * />
 * ```
 *
 * @since 1.4.0
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useActivation } from './useActivation'
import { useCustomer } from './useCustomer'
import { useLimits } from './useLimits'
import { usePlans } from './usePlans'

export interface UseAutoActivateFreePlanOptions {
  productRef: string | undefined
  /**
   * Skip auto-activation entirely. Defaults to `true`. Useful for SSR
   * or when the host wants to gate on its own readiness signal before
   * letting the hook fire.
   */
  enabled?: boolean
  /**
   * Fired once after a successful activation + post-activate refetch
   * confirms the customer is on the free plan. Use for analytics / UI
   * confirmation; not required for the hook to function.
   */
  onActivated?: () => void
}

export interface UseAutoActivateFreePlanReturn {
  /**
   * `true` from the moment the backend reports `activationRequired:
   * true` (and a free plan is configured) until the post-activation
   * refetch confirms the customer is on the free tier. Drives
   * skeleton / optimistic-value gates so the UI doesn't flash "0 left"
   * mid-activation.
   *
   * Stays `false` when there's no free plan to activate — the
   * consumer should commit to the real `remaining` value in that case.
   */
  pending: boolean
  /** `true` after a successful activation has been confirmed. */
  activated: boolean
  /** Last activation error, or `null` if the most recent attempt succeeded. */
  error: Error | null
}

export function useAutoActivateFreePlan(
  options: UseAutoActivateFreePlanOptions,
): UseAutoActivateFreePlanReturn {
  const { productRef, enabled = true, onActivated } = options

  const { customerRef } = useCustomer()
  const { activationRequired, refetch: refetchLimits } = useLimits({
    productRef,
    enabled,
  })
  const { plans } = usePlans({ productRef })
  const { activate, error: activationError } = useActivation()

  const freePlan = useMemo(
    () => plans.find(p => p.requiresPayment === false && (p.freeUnits ?? 0) > 0),
    [plans],
  )

  // One-shot guard so a failed `activate` doesn't retry on every
  // render. Reset when `${customerRef}:${productRef}` changes —
  // scenario switches and identity resets re-arm.
  const attemptedKeyRef = useRef<string | null>(null)
  const [activated, setActivated] = useState(false)

  // Keep `onActivated` out of the activation effect's dep array so
  // callers can pass an inline arrow without retriggering the effect.
  const onActivatedRef = useRef(onActivated)
  useEffect(() => {
    onActivatedRef.current = onActivated
  }, [onActivated])

  useEffect(() => {
    attemptedKeyRef.current = null
    setActivated(false)
  }, [customerRef, productRef])

  // True only when the backend asks for activation AND a free plan is
  // configured for this product. PAYG-only products (no free plan)
  // skip activation entirely so the consumer can commit to the real
  // backend value instead of stalling on a skeleton.
  const shouldActivate =
    enabled && activationRequired === true && Boolean(productRef) && Boolean(freePlan?.reference)

  useEffect(() => {
    if (!shouldActivate || !productRef || !freePlan?.reference) return
    const key = `${customerRef ?? 'anonymous'}:${productRef}`
    if (attemptedKeyRef.current === key) return
    attemptedKeyRef.current = key
    activate({ productRef, planRef: freePlan.reference })
      .then(() => refetchLimits())
      .then(() => {
        setActivated(true)
        onActivatedRef.current?.()
      })
      .catch(() => {
        // Activation or refetch failed — the one-shot guard keeps us
        // from retrying. The consumer's existing 402 handling will
        // surface the activation flow on the next gated request.
      })
  }, [shouldActivate, freePlan?.reference, productRef, customerRef, activate, refetchLimits])

  return {
    // While `activationRequired === true` AND we have a free plan
    // queued up, mask the consumer's view. A successful refetch
    // flips `activationRequired` to `false`, naturally clearing
    // `pending`. A failure leaves `pending: true` until a key change
    // re-arms — matches the original demo's behaviour where the pill
    // shows the optimistic ceiling rather than the backend's `0`.
    pending: shouldActivate,
    activated,
    error: activationError ? new Error(activationError) : null,
  }
}
