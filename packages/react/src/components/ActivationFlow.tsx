'use client'
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useActivation } from '../hooks/useActivation'
import { useTopupAmountSelector } from '../hooks/useTopupAmountSelector'
import { useBalance } from '../hooks/useBalance'
import { useCopy } from '../hooks/useCopy'
import { usePlan } from '../hooks/usePlan'
import { TopupForm } from '../TopupForm'
import { CheckoutSummary } from './CheckoutSummary'
import { AmountPicker } from './AmountPicker'
import { usePlanSelection } from './PlanSelectionContext'
import type { ActivationResult, Plan, UseTopupAmountSelectorReturn } from '../types'

export type ActivationFlowStep =
  | 'summary'
  | 'activating'
  | 'selectAmount'
  | 'topupPayment'
  | 'retrying'
  | 'activated'
  | 'error'

export interface ActivationFlowClassNames {
  root?: string
  heading?: string
  summaryBox?: string
  activateButton?: string
  topupHeading?: string
  topupSubheading?: string
  continueButton?: string
  changeAmountButton?: string
  retryingBox?: string
  activatedBox?: string
  errorBox?: string
  backButton?: string
}

export interface ActivationFlowRenderArgs {
  step: ActivationFlowStep
  plan: Plan | null
  amountSelector: UseTopupAmountSelectorReturn
  activate: () => Promise<void>
  reset: () => void
}

export interface ActivationFlowProps {
  productRef: string
  /** Defaults to PlanSelectionContext selection when omitted. */
  planRef?: string
  onSuccess?: (result: ActivationResult) => void
  onError?: (error: Error) => void
  onBack?: () => void
  /** Delay before retrying activation after TopupForm succeeds. */
  retryDelayMs?: number
  /** Delay for the second retry when status is still topup_required. */
  retryBackoffMs?: number
  classNames?: ActivationFlowClassNames
  className?: string
  unstyled?: boolean
  children?: React.ReactNode | ((args: ActivationFlowRenderArgs) => React.ReactNode)
}

type ActivationFlowContext = {
  step: ActivationFlowStep
  plan: Plan | null
  productRef: string
  planRef: string
  amountSelector: UseTopupAmountSelectorReturn
  activate: () => Promise<void>
  reset: () => void
  goToSelectAmount: () => void
  classNames: ActivationFlowClassNames
  unstyled: boolean
  error: string | null
  onBack?: () => void
  onTopupSuccess: () => Promise<void>
}

const ActivationFlowCtx = createContext<ActivationFlowContext | null>(null)

function useActivationFlow(): ActivationFlowContext {
  const ctx = useContext(ActivationFlowCtx)
  if (!ctx) {
    throw new Error(
      'ActivationFlow.Summary / ActivationFlow.AmountPicker must be rendered inside <ActivationFlow>',
    )
  }
  return ctx
}

const Summary: React.FC<{ className?: string }> = ({ className }) => {
  const ctx = useActivationFlow()
  const copy = useCopy()
  const isActivating = ctx.step === 'activating'
  const disabled = isActivating
  return (
    <div className={className ?? ctx.classNames.summaryBox}>
      <CheckoutSummary planRef={ctx.planRef} productRef={ctx.productRef} />
      <button
        type="button"
        onClick={ctx.activate}
        disabled={disabled}
        className={ctx.classNames.activateButton}
        style={
          ctx.unstyled || ctx.classNames.activateButton
            ? undefined
            : primaryButtonStyle(disabled)
        }
        aria-busy={isActivating}
      >
        {isActivating ? copy.activationFlow.activatingLabel : copy.activationFlow.activateButton}
      </button>
    </div>
  )
}

const AmountPickerSlot: React.FC<{ className?: string }> = ({ className }) => {
  const ctx = useActivationFlow()
  const copy = useCopy()
  const currency = ctx.plan?.currency ?? 'USD'
  return (
    <div className={className}>
      <h3
        className={ctx.classNames.topupHeading}
        style={ctx.unstyled || ctx.classNames.topupHeading ? undefined : headingStyle}
      >
        {copy.activationFlow.topupHeading}
      </h3>
      <p
        className={ctx.classNames.topupSubheading}
        style={
          ctx.unstyled || ctx.classNames.topupSubheading
            ? undefined
            : { fontSize: 14, color: 'rgba(0,0,0,0.55)', margin: '4px 0 12px' }
        }
      >
        {copy.activationFlow.topupSubheading}
      </p>
      <AmountPicker currency={currency} />
      <button
        type="button"
        onClick={() => {
          if (ctx.amountSelector.validate()) {
            ctx.goToSelectAmount()
          }
        }}
        disabled={!ctx.amountSelector.resolvedAmount}
        className={ctx.classNames.continueButton}
        style={
          ctx.unstyled || ctx.classNames.continueButton
            ? undefined
            : primaryButtonStyle(!ctx.amountSelector.resolvedAmount)
        }
      >
        {copy.activationFlow.continueToPayment}
      </button>
    </div>
  )
}

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  marginTop: 12,
  padding: '12px 20px',
  borderRadius: 8,
  border: 'none',
  background: disabled ? 'rgba(0,0,0,0.15)' : '#0f172a',
  color: '#fff',
  fontWeight: 600,
  fontSize: 15,
  cursor: disabled ? 'not-allowed' : 'pointer',
  width: '100%',
})

const headingStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: '#0f172a',
  margin: 0,
}

type ActivationFlowComponent = React.FC<ActivationFlowProps> & {
  Summary: typeof Summary
  AmountPicker: typeof AmountPickerSlot
}

/**
 * Styled orchestrator for usage-based plan activation.
 *
 * Drives the full state machine: plan summary → activating → (topup_required →
 * amount picker → topup payment → retry with backoff) → activated. Wraps
 * `useActivation`, `useTopupAmountSelector`, `useBalance`, and the `<TopupForm>`
 * primitive; the two slot subcomponents (`Summary`, `AmountPicker`) can be
 * overridden for bespoke layouts.
 */
export const ActivationFlow: ActivationFlowComponent = Object.assign(
  ((props: ActivationFlowProps) => {
    const {
      productRef,
      planRef: planRefProp,
      onSuccess,
      onError,
      onBack,
      retryDelayMs = 1500,
      retryBackoffMs = 2000,
      classNames = {},
      className,
      unstyled = false,
      children,
    } = props

    const copy = useCopy()
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

    // Map raw activation states → flow step
    useEffect(() => {
      if (state === 'activated' && !calledSuccessRef.current) {
        calledSuccessRef.current = true
        setStep('activated')
        if (result) {
          const activationResult: ActivationResult = { kind: 'activated', result }
          onSuccess?.(activationResult)
        }
      }
    }, [state, result, onSuccess])

    useEffect(() => {
      if (state === 'topup_required' && (step === 'summary' || step === 'activating')) {
        setStep('selectAmount')
      }
    }, [state, step])

    useEffect(() => {
      if ((state === 'error' || state === 'payment_required') && error) {
        setStep('error')
        if (state === 'error') onError?.(new Error(error))
      }
    }, [state, error, onError])

    const handleActivate = useCallback(async () => {
      if (!resolvedPlanRef) return
      setStep('activating')
      await activate({ productRef, planRef: resolvedPlanRef })
    }, [activate, productRef, resolvedPlanRef])

    const goToSelectAmount = useCallback(() => {
      setStep('topupPayment')
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

    // Second retry with backoff when still topup_required
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

    const ctxValue: ActivationFlowContext = useMemo(
      () => ({
        step,
        plan,
        productRef,
        planRef: resolvedPlanRef ?? '',
        amountSelector,
        activate: handleActivate,
        reset: resetFlow,
        goToSelectAmount,
        classNames,
        unstyled,
        error,
        onBack,
        onTopupSuccess: handleTopupSuccess,
      }),
      [
        step,
        plan,
        productRef,
        resolvedPlanRef,
        amountSelector,
        handleActivate,
        resetFlow,
        goToSelectAmount,
        classNames,
        unstyled,
        error,
        onBack,
        handleTopupSuccess,
      ],
    )

    if (typeof children === 'function') {
      return (
        <ActivationFlowCtx.Provider value={ctxValue}>
          {children({
            step,
            plan,
            amountSelector,
            activate: handleActivate,
            reset: resetFlow,
          })}
        </ActivationFlowCtx.Provider>
      )
    }

    // Custom slot composition
    if (children) {
      return (
        <ActivationFlowCtx.Provider value={ctxValue}>
          <div
            data-solvapay-activation-flow=""
            className={className ?? classNames.root}
          >
            {children}
          </div>
        </ActivationFlowCtx.Provider>
      )
    }

    // Default tree — step-driven
    const body = (() => {
      if (step === 'activated') {
        return (
          <div
            className={classNames.activatedBox}
            data-solvapay-activation-step="activated"
            style={unstyled || classNames.activatedBox ? undefined : activatedStyle}
          >
            <h3 style={unstyled ? undefined : { ...headingStyle, color: '#166534' }}>
              {copy.activationFlow.activatedHeading}
            </h3>
            <p
              style={
                unstyled
                  ? undefined
                  : { fontSize: 14, color: '#16a34a', margin: '4px 0 0' }
              }
            >
              {copy.activationFlow.activatedSubheading}
            </p>
          </div>
        )
      }

      if (step === 'retrying') {
        return (
          <div
            className={classNames.retryingBox}
            data-solvapay-activation-step="retrying"
            style={unstyled || classNames.retryingBox ? undefined : retryingStyle}
          >
            <h3 style={unstyled ? undefined : headingStyle}>
              {copy.activationFlow.retryingHeading}
            </h3>
            <p
              style={
                unstyled
                  ? undefined
                  : { fontSize: 14, color: 'rgba(0,0,0,0.55)', margin: '4px 0 0' }
              }
            >
              {copy.activationFlow.retryingSubheading}
            </p>
          </div>
        )
      }

      if (step === 'topupPayment') {
        const amountCents = Math.round((amountSelector.resolvedAmount || 0) * 100)
        return (
          <div data-solvapay-activation-step="topupPayment">
            <div style={unstyled ? undefined : { marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setStep('selectAmount')}
                className={classNames.changeAmountButton}
                style={
                  unstyled || classNames.changeAmountButton
                    ? undefined
                    : { background: 'none', border: 'none', color: 'rgba(0,0,0,0.6)', cursor: 'pointer', fontSize: 14 }
                }
              >
                {copy.activationFlow.changeAmountButton}
              </button>
            </div>
            <TopupForm
              amount={amountCents}
              currency={currency}
              onSuccess={handleTopupSuccess}
              onError={err => onError?.(err instanceof Error ? err : new Error(String(err)))}
            />
          </div>
        )
      }

      if (step === 'selectAmount') {
        return (
          <div data-solvapay-activation-step="selectAmount">
            <AmountPickerSlot />
          </div>
        )
      }

      if (step === 'error') {
        return (
          <div
            className={classNames.errorBox}
            data-solvapay-activation-step="error"
            style={unstyled || classNames.errorBox ? undefined : errorStyle}
          >
            <p style={unstyled ? undefined : { color: '#b91c1c', margin: 0 }}>{error}</p>
            <button
              type="button"
              onClick={resetFlow}
              style={unstyled ? undefined : primaryButtonStyle(false)}
            >
              {copy.activationFlow.tryAgainButton}
            </button>
          </div>
        )
      }

      // summary + activating both use Summary slot
      return (
        <>
          <h3
            className={classNames.heading}
            style={unstyled || classNames.heading ? undefined : headingStyle}
          >
            {copy.activationFlow.heading}
          </h3>
          <Summary />
        </>
      )
    })()

    return (
      <ActivationFlowCtx.Provider value={ctxValue}>
        <div
          data-solvapay-activation-flow=""
          className={className ?? classNames.root}
          style={
            unstyled || className || classNames.root
              ? undefined
              : { display: 'flex', flexDirection: 'column', gap: 12 }
          }
        >
          {body}
          {onBack && step === 'summary' && (
            <button
              type="button"
              onClick={onBack}
              className={classNames.backButton}
              style={
                unstyled || classNames.backButton
                  ? undefined
                  : { background: 'none', border: 'none', color: 'rgba(0,0,0,0.6)', cursor: 'pointer', fontSize: 14, alignSelf: 'flex-start' }
              }
            >
              {copy.activationFlow.backButton}
            </button>
          )}
        </div>
      </ActivationFlowCtx.Provider>
    )
  }) as React.FC<ActivationFlowProps>,
  { Summary, AmountPicker: AmountPickerSlot },
)

const activatedStyle: React.CSSProperties = {
  background: '#f0fdf4',
  border: '1px solid #bbf7d0',
  borderRadius: 12,
  padding: 20,
}

const retryingStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: 20,
}

const errorStyle: React.CSSProperties = {
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 12,
  padding: 16,
}
