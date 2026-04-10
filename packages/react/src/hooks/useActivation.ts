import { useState, useCallback } from 'react'
import { useSolvaPay } from './useSolvaPay'
import type { ActivatePlanResult } from '../types'

export type ActivationState =
  | 'idle'
  | 'activating'
  | 'activated'
  | 'topup_required'
  | 'payment_required'
  | 'error'

export interface UseActivationReturn {
  activate: (params: { productRef: string; planRef: string }) => Promise<void>
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
  const [state, setState] = useState<ActivationState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ActivatePlanResult | null>(null)

  const activate = useCallback(
    async (params: { productRef: string; planRef: string }) => {
      setState('activating')
      setError(null)
      setResult(null)

      try {
        const data = await activatePlan(params)
        setResult(data)

        switch (data.status) {
          case 'activated':
          case 'already_active':
            setState('activated')
            break
          case 'topup_required':
            setState('topup_required')
            break
          case 'payment_required':
            setError('This plan requires payment. Please select a different plan.')
            setState('payment_required')
            break
          case 'invalid':
            setError(data.message || 'Invalid plan configuration.')
            setState('error')
            break
          default:
            setError('Unexpected response from server.')
            setState('error')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Activation failed')
        setState('error')
      }
    },
    [activatePlan],
  )

  const reset = useCallback(() => {
    setState('idle')
    setError(null)
    setResult(null)
  }, [])

  return { activate, state, error, result, reset }
}
