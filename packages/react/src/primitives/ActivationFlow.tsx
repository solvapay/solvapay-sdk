'use client'

/**
 * ActivationFlow compound primitive.
 *
 * Drives the usage-based plan activation state machine:
 *   summary → activating → (topup_required → selectAmount → topupPayment →
 *     retrying) → activated | error.
 *
 * `Root` exposes `data-state` set to the current step and publishes the
 * shared context consumed by leaves. Leaves render only during their
 * matching step:
 *  - `Summary` — `summary` | `activating`
 *  - `ActivateButton` — `summary` | `activating`
 *  - `AmountPicker` — `selectAmount`
 *  - `ContinueButton` — `selectAmount`
 *  - `Retrying` — `retrying`
 *  - `Activated` — `activated`
 *  - `Loading` — renders when plan is not yet resolved
 *  - `Error` — `error`
 */

import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Slot } from './slot'
import { composeEventHandlers } from './composeEventHandlers'
import { AmountPicker as AmountPickerPrimitive } from './AmountPicker'
import { useActivation } from '../hooks/useActivation'
import { useTopupAmountSelector } from '../hooks/useTopupAmountSelector'
import { useBalance } from '../hooks/useBalance'
import { useCopy } from '../hooks/useCopy'
import { usePlan } from '../hooks/usePlan'
import { usePlanSelection } from '../components/PlanSelectionContext'
import { SolvaPayContext } from '../SolvaPayProvider'
import {
  MissingProductRefError,
  MissingProviderError,
} from '../utils/errors'
import type {
  ActivationResult,
  Plan,
  UseTopupAmountSelectorReturn,
} from '../types'

export type ActivationFlowStep =
  | 'summary'
  | 'activating'
  | 'selectAmount'
  | 'topupPayment'
  | 'retrying'
  | 'activated'
  | 'error'

type ActivationFlowContextValue = {
  step: ActivationFlowStep
  plan: Plan | null
  productRef: string
  planRef: string
  amountSelector: UseTopupAmountSelectorReturn
  amountCents: number
  currency: string
  activate: () => Promise<void>
  reset: () => void
  goToTopupPayment: () => void
  backToSelectAmount: () => void
  onTopupSuccess: () => Promise<void>
  error: string | null
  onError?: (error: Error) => void
}

const ActivationFlowContext = createContext<ActivationFlowContextValue | null>(null)

function useFlowCtx(part: string): ActivationFlowContextValue {
  const ctx = useContext(ActivationFlowContext)
  if (!ctx) {
    throw new Error(`ActivationFlow.${part} must be rendered inside <ActivationFlow.Root>.`)
  }
  return ctx
}

type RootProps = {
  productRef?: string
  /** Defaults to PlanSelectionContext selection when omitted. */
  planRef?: string
  onSuccess?: (result: ActivationResult) => void
  onError?: (error: Error) => void
  retryDelayMs?: number
  retryBackoffMs?: number
  asChild?: boolean
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'onError'>

const Root = forwardRef<HTMLDivElement, RootProps>(function ActivationFlowRoot(
  {
    productRef,
    planRef: planRefProp,
    onSuccess,
    onError,
    retryDelayMs = 1500,
    retryBackoffMs = 2000,
    asChild,
    children,
    ...rest
  },
  forwardedRef,
) {
  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('ActivationFlow')
  if (!productRef) throw new MissingProductRefError('ActivationFlow')

  const planSelection = usePlanSelection()
  const resolvedPlanRef = planRefProp ?? planSelection?.selectedPlanRef ?? undefined
  const { plan } = usePlan({ planRef: resolvedPlanRef, productRef })
  const { activate, state, error, result, reset } = useActivation()
  const currency = plan?.currency ?? 'USD'
  const amountSelector = useTopupAmountSelector({ currency })
  const { adjustBalance, creditsPerMinorUnit, displayExchangeRate } = useBalance()

  const [step, setStep] = useState<ActivationFlowStep>('summary')
  const calledSuccessRef = useRef(false)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Step transitions are driven by external activation state; setStep inside
  // useEffect is intentional — the hook's state is the external system we're
  // syncing to. Lint suppression below rather than refactor around it.
  useEffect(() => {
    if (state === 'activated' && !calledSuccessRef.current) {
      calledSuccessRef.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep('activated')
      if (result) {
        const activationResult: ActivationResult = { kind: 'activated', result }
        onSuccess?.(activationResult)
      }
    }
  }, [state, result, onSuccess])

  useEffect(() => {
    if (state === 'topup_required' && (step === 'summary' || step === 'activating')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep('selectAmount')
    }
  }, [state, step])

  useEffect(() => {
    if ((state === 'error' || state === 'payment_required') && error) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep('error')
      if (state === 'error') onError?.(new Error(error))
    }
  }, [state, error, onError])

  const handleActivate = useCallback(async () => {
    if (!resolvedPlanRef) return
    setStep('activating')
    await activate({ productRef, planRef: resolvedPlanRef })
  }, [activate, productRef, resolvedPlanRef])

  const goToTopupPayment = useCallback(() => {
    if (amountSelector.validate()) setStep('topupPayment')
  }, [amountSelector])

  const backToSelectAmount = useCallback(() => {
    setStep('selectAmount')
  }, [])

  const retryActivation = useCallback(async () => {
    if (!resolvedPlanRef) return
    setStep('retrying')

    const amountMinor = Math.round((amountSelector.resolvedAmount || 0) * 100)
    const rate = displayExchangeRate ?? 1
    if (creditsPerMinorUnit) {
      adjustBalance(Math.floor((amountMinor / rate) * creditsPerMinorUnit))
    }

    await new Promise(r => setTimeout(r, retryDelayMs))
    await activate({ productRef, planRef: resolvedPlanRef })
  }, [
    resolvedPlanRef,
    amountSelector.resolvedAmount,
    displayExchangeRate,
    creditsPerMinorUnit,
    adjustBalance,
    retryDelayMs,
    activate,
    productRef,
  ])

  const handleTopupSuccess = useCallback(async () => {
    await retryActivation()
  }, [retryActivation])

  useEffect(() => {
    if (step !== 'retrying') return
    if (state !== 'topup_required') return
    if (!resolvedPlanRef) return
    retryTimeoutRef.current = setTimeout(async () => {
      await activate({ productRef, planRef: resolvedPlanRef })
    }, retryBackoffMs)
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
    }
  }, [step, state, resolvedPlanRef, retryBackoffMs, activate, productRef])

  const resetFlow = useCallback(() => {
    reset()
    calledSuccessRef.current = false
    setStep('summary')
  }, [reset])

  const amountCents = Math.round((amountSelector.resolvedAmount || 0) * 100)

  const ctx = useMemo<ActivationFlowContextValue>(
    () => ({
      step,
      plan,
      productRef,
      planRef: resolvedPlanRef ?? '',
      amountSelector,
      amountCents,
      currency,
      activate: handleActivate,
      reset: resetFlow,
      goToTopupPayment,
      backToSelectAmount,
      onTopupSuccess: handleTopupSuccess,
      error,
      onError,
    }),
    [
      step,
      plan,
      productRef,
      resolvedPlanRef,
      amountSelector,
      amountCents,
      currency,
      handleActivate,
      resetFlow,
      goToTopupPayment,
      backToSelectAmount,
      handleTopupSuccess,
      error,
      onError,
    ],
  )

  const Comp = asChild ? Slot : 'div'
  return (
    <ActivationFlowContext.Provider value={ctx}>
      <Comp
        ref={forwardedRef}
        data-solvapay-activation-flow=""
        data-state={step}
        {...rest}
      >
        {children}
      </Comp>
    </ActivationFlowContext.Provider>
  )
})

type SlotProps = React.HTMLAttributes<HTMLDivElement> & { asChild?: boolean }

function matchStep(step: ActivationFlowStep, allowed: ActivationFlowStep[]): boolean {
  return allowed.includes(step)
}

const Summary = forwardRef<HTMLDivElement, SlotProps>(function ActivationFlowSummary(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useFlowCtx('Summary')
  if (!matchStep(ctx.step, ['summary', 'activating'])) return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-activation-flow-summary="" {...rest}>
      {children}
    </Comp>
  )
})

type ActivateButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
}

const ActivateButton = forwardRef<HTMLButtonElement, ActivateButtonProps>(
  function ActivationFlowActivateButton(
    { asChild, onClick, children, ...rest },
    forwardedRef,
  ) {
    const ctx = useFlowCtx('ActivateButton')
    const copy = useCopy()
    if (!matchStep(ctx.step, ['summary', 'activating'])) return null

    const isActivating = ctx.step === 'activating'
    const disabled = isActivating

    const commonProps = {
      'data-solvapay-activation-flow-activate': '',
      'data-state': isActivating ? 'activating' : 'idle',
      'aria-busy': isActivating,
      disabled,
      onClick: composeEventHandlers(onClick, () => {
        void ctx.activate()
      }),
      ...rest,
    } satisfies React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>

    const label = isActivating
      ? copy.activationFlow.activatingLabel
      : copy.activationFlow.activateButton

    if (asChild) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)}>
          {children ?? <>{label}</>}
        </Slot>
      )
    }
    return (
      <button ref={forwardedRef} type="button" {...commonProps}>
        {children ?? label}
      </button>
    )
  },
)

type AmountPickerMountProps = {
  children?: React.ReactNode
}

/**
 * Mounts the shared AmountPicker primitive during the `selectAmount` step.
 * The sub-picker is driven by the flow's top-level `useTopupAmountSelector`
 * instance so selections persist through the retry cycle.
 */
const AmountPickerMount: React.FC<AmountPickerMountProps> = ({ children }) => {
  const ctx = useFlowCtx('AmountPicker')
  if (ctx.step !== 'selectAmount') return null
  return (
    <div data-solvapay-activation-flow-amount-picker="">
      <AmountPickerPrimitive.Root currency={ctx.currency} selector={ctx.amountSelector}>
        {children}
      </AmountPickerPrimitive.Root>
    </div>
  )
}

type ContinueButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
}

const ContinueButton = forwardRef<HTMLButtonElement, ContinueButtonProps>(
  function ActivationFlowContinueButton(
    { asChild, onClick, children, ...rest },
    forwardedRef,
  ) {
    const ctx = useFlowCtx('ContinueButton')
    const copy = useCopy()
    if (ctx.step !== 'selectAmount') return null

    const disabled = !ctx.amountSelector.resolvedAmount

    const commonProps = {
      'data-solvapay-activation-flow-continue': '',
      'data-state': disabled ? 'disabled' : 'idle',
      disabled,
      'aria-disabled': disabled || undefined,
      onClick: composeEventHandlers(onClick, () => {
        ctx.goToTopupPayment()
      }),
      ...rest,
    } satisfies React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>

    if (asChild) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(commonProps as Record<string, unknown>)}>
          {children ?? <>{copy.activationFlow.continueToPayment}</>}
        </Slot>
      )
    }
    return (
      <button ref={forwardedRef} type="button" {...commonProps}>
        {children ?? copy.activationFlow.continueToPayment}
      </button>
    )
  },
)

const Retrying = forwardRef<HTMLDivElement, SlotProps>(function ActivationFlowRetrying(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useFlowCtx('Retrying')
  if (ctx.step !== 'retrying') return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-activation-flow-retrying="" {...rest}>
      {children}
    </Comp>
  )
})

const Activated = forwardRef<HTMLDivElement, SlotProps>(function ActivationFlowActivated(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useFlowCtx('Activated')
  if (ctx.step !== 'activated') return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-activation-flow-activated="" {...rest}>
      {children}
    </Comp>
  )
})

const Loading = forwardRef<HTMLDivElement, SlotProps>(function ActivationFlowLoading(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useFlowCtx('Loading')
  if (ctx.plan) return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp ref={forwardedRef} data-solvapay-activation-flow-loading="" {...rest}>
      {children}
    </Comp>
  )
})

const ErrorSlot = forwardRef<HTMLDivElement, SlotProps>(function ActivationFlowError(
  { asChild, children, ...rest },
  forwardedRef,
) {
  const ctx = useFlowCtx('Error')
  if (ctx.step !== 'error') return null
  const Comp = asChild ? Slot : 'div'
  return (
    <Comp
      ref={forwardedRef}
      role="alert"
      data-solvapay-activation-flow-error=""
      {...rest}
    >
      {children ?? ctx.error}
    </Comp>
  )
})

export const ActivationFlowRoot = Root
export const ActivationFlowSummary = Summary
export const ActivationFlowActivateButton = ActivateButton
export const ActivationFlowAmountPicker = AmountPickerMount
export const ActivationFlowContinueButton = ContinueButton
export const ActivationFlowRetrying = Retrying
export const ActivationFlowActivated = Activated
export const ActivationFlowLoading = Loading
export const ActivationFlowError = ErrorSlot

export const ActivationFlow = {
  Root,
  Summary,
  ActivateButton,
  AmountPicker: AmountPickerMount,
  ContinueButton,
  Retrying,
  Activated,
  Loading,
  Error: ErrorSlot,
} as const

export function useActivationFlow(): ActivationFlowContextValue {
  return useFlowCtx('useActivationFlow')
}
