import { useState, useCallback } from 'react'
import { useSolvaPay } from './useSolvaPay'
import { useCopy } from './useCopy'
import type { ActivatePlanResult } from '../types'

export type ActivationState =
  | 'idle'
  | 'activating'
  | 'activated'
  | 'topup_required'
  | 'payment_required'
  | 'error'

export interface UseActivationReturn {
  activate: (params: { productRef: string; planRef: string }) => Promise<ActivationState>
  state: ActivationState
  error: string | null
  result: ActivatePlanResult | null
  reset: () => void
}

/**
 * State-machine hook for the plan activation flow.
 *
 * Wraps `activatePlan` from context and maps API response statuses
 * to discrete UI states: idle → activating → activated | topup_required | payment_required | error.
 *
 * Auto-refetches purchase data on successful activation (handled by context).
 *
 * @example
 * ```tsx
 * const { activate, state, error, reset } = useActivation()
 *
 * if (state === 'topup_required') return <TopupPrompt />
 * if (state === 'activated') return <SuccessMessage />
 *
 * <button onClick={() => activate({ productRef, planRef })} disabled={state === 'activating'}>
 *   Activate
 * </button>
 * ```
 */
export function useActivation(): UseActivationReturn {
  const { activatePlan } = useSolvaPay()
  const copy = useCopy()
  const [state, setState] = useState<ActivationState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ActivatePlanResult | null>(null)

  const activate = useCallback(
    async (params: { productRef: string; planRef: string }): Promise<ActivationState> => {
      setState('activating')
      setError(null)
      setResult(null)

      try {
        const data = await activatePlan(params)
        setResult(data)

        switch (data.status) {
          case 'activated':
          case 'already_active':
          case 'already_purchased':
            setState('activated')
            return 'activated'
          case 'topup_required':
            setState('topup_required')
            return 'topup_required'
          case 'payment_required':
            setError(copy.activation.paymentRequired)
            setState('payment_required')
            return 'payment_required'
          case 'invalid':
            setError(data.message || copy.activation.invalidConfiguration)
            setState('error')
            return 'error'
          default:
            setError(copy.activation.unexpectedResponse)
            setState('error')
            return 'error'
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : copy.activation.failed)
        setState('error')
        return 'error'
      }
    },
    [activatePlan, copy],
  )

  const reset = useCallback(() => {
    setState('idle')
    setError(null)
    setResult(null)
  }, [])

  return { activate, state, error, result, reset }
}
