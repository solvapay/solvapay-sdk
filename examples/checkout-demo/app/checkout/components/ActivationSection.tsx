'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { Plan } from '@solvapay/react'
import { useActivation, useTopupAmountSelector, useBalance, TopupForm } from '@solvapay/react'
import { formatCreditsPerUnit } from '../utils/planHelpers'
import { TopupAmountPicker } from './TopupAmountPicker'
import { Button, actionButtonClassName } from '../../components/ui/Button'
import '../payment-form.css'

type FlowStep = 'plan_summary' | 'select_amount' | 'payment' | 'retrying_activation' | 'activated'

interface ActivationSectionProps {
  currentPlan: Plan
  productRef?: string
  onSuccess: () => void
  onBack: () => void
}

const RETRY_DELAY_MS = 1500
const RETRY_BACKOFF_MS = 2000

export function ActivationSection({
  currentPlan,
  productRef,
  onSuccess,
  onBack,
}: ActivationSectionProps) {
  const { activate, state, error, reset } = useActivation()
  const currency = currentPlan.currency || 'USD'
  const amountSelector = useTopupAmountSelector({ currency })
  const { adjustBalance, creditsPerMinorUnit } = useBalance()

  const [step, setStep] = useState<FlowStep>('plan_summary')
  const calledSuccessRef = useRef(false)

  const creditCost = formatCreditsPerUnit(currentPlan.creditsPerUnit)
  const unit = currentPlan.measures || 'use'
  const planLabel =
    typeof currentPlan.metadata?.name === 'string'
      ? currentPlan.metadata.name
      : currentPlan.reference

  useEffect(() => {
    if (state === 'activated' && !calledSuccessRef.current) {
      calledSuccessRef.current = true
      setStep('activated')
      onSuccess()
    }
  }, [state, onSuccess])

  useEffect(() => {
    if (state === 'topup_required' && step === 'plan_summary') {
      setStep('select_amount')
    }
  }, [state, step])

  const handleActivate = async () => {
    if (!productRef) return
    await activate({ productRef, planRef: currentPlan.reference })
  }

  const handleContinueToPayment = () => {
    if (!amountSelector.validate()) return
    setStep('payment')
  }

  const retryActivation = useCallback(async () => {
    if (!productRef) return
    setStep('retrying_activation')

    const amountCents = Math.round((amountSelector.resolvedAmount || 0) * 100)
    adjustBalance(amountCents)

    await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    await activate({ productRef, planRef: currentPlan.reference })
  }, [productRef, activate, currentPlan.reference, amountSelector.resolvedAmount, adjustBalance])

  const handleTopupSuccess = useCallback(async () => {
    await retryActivation()
  }, [retryActivation])

  useEffect(() => {
    if (step === 'retrying_activation' && state === 'topup_required') {
      const timer = setTimeout(async () => {
        if (!productRef) return
        await activate({ productRef, planRef: currentPlan.reference })
      }, RETRY_BACKOFF_MS)
      return () => clearTimeout(timer)
    }
  }, [step, state, productRef, activate, currentPlan.reference])

  if (step === 'activated') {
    return (
      <div className="space-y-6">
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-green-900 mb-1">Plan selected</h3>
          <p className="text-sm text-green-700">Your plan is now active.</p>
          <p className="text-xs text-green-600 mt-2">Redirecting...</p>
        </div>
      </div>
    )
  }

  if (step === 'retrying_activation') {
    return (
      <div className="space-y-6">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
          <svg
            className="animate-spin h-8 w-8 text-slate-600 mx-auto mb-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Activating your plan...</h3>
          <p className="text-sm text-slate-500">Payment received. Setting up your plan.</p>
        </div>
      </div>
    )
  }

  if (step === 'payment') {
    const amountCents = Math.round((amountSelector.resolvedAmount || 0) * 100)

    return (
      <div className="space-y-8">
        <h3 className="text-lg font-semibold text-slate-900 pb-2">Complete payment</h3>

        <div className="flex items-center justify-between py-3 px-4 bg-slate-50 rounded-lg border border-slate-100">
          <p className="text-sm text-slate-600">
            Credit top-up: <span className="font-semibold text-slate-900">
              {amountSelector.currencySymbol}{amountSelector.resolvedAmount?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </p>
          <button
            type="button"
            onClick={() => setStep('select_amount')}
            className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
          >
            Change amount
          </button>
        </div>

        <TopupForm
          amount={amountCents}
          currency={currency}
          onSuccess={handleTopupSuccess}
          onError={err => console.error('Top-up error:', err)}
          submitButtonText="Top Up"
          className="space-y-4 payment-form-wrapper"
          buttonClassName={actionButtonClassName}
        />

        <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 block">
          &larr; Back to plan selection
        </button>
      </div>
    )
  }

  if (step === 'select_amount') {
    return (
      <div className="space-y-6">
        <h3 className="text-lg font-semibold text-slate-900">Add credits</h3>
        <p className="text-sm text-slate-500">
          Top up your credits to activate this plan. Credits are consumed as you use the product.
        </p>

        <TopupAmountPicker
          {...amountSelector}
          creditsPerMinorUnit={creditsPerMinorUnit}
          onContinue={handleContinueToPayment}
        />

        <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 block">
          &larr; Back to plan selection
        </button>
      </div>
    )
  }

  if (state === 'error' || state === 'payment_required') {
    return (
      <div className="space-y-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-sm text-red-700">{error}</p>
        </div>
        <Button variant="action" onClick={reset}>
          Try Again
        </Button>
        <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 block">
          &larr; Back to plan selection
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-slate-900">Confirm your plan</h3>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
        <h4 className="text-sm font-medium text-slate-900">Plan Summary</h4>
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Plan</span>
          <span className="font-medium text-slate-900">{planLabel}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Pricing</span>
          <span className="font-medium text-slate-900">{creditCost} credits / {unit}</span>
        </div>
        {currentPlan.freeUnits ? (
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Free units</span>
            <span className="font-medium text-slate-900">
              {currentPlan.freeUnits} {unit}s included
            </span>
          </div>
        ) : null}
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Billing</span>
          <span className="font-medium text-slate-900">Pay as you go</span>
        </div>
      </div>

      <p className="text-sm text-slate-500">
        You&apos;ll be charged based on usage. No upfront payment required.
      </p>

      <Button
        variant="action"
        onClick={handleActivate}
        isLoading={state === 'activating'}
        loadingText="Activating..."
      >
        Select Plan
      </Button>

      <div className="pt-4 border-t border-slate-200 space-y-2">
        <p className="text-xs text-slate-400 text-center">Powered by SolvaPay</p>
        <div className="flex justify-center space-x-4 text-xs text-slate-400">
          <button className="hover:text-slate-600 transition-colors">Terms</button>
          <button className="hover:text-slate-600 transition-colors">Privacy</button>
        </div>
      </div>

      <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 block">
        &larr; Back to plan selection
      </button>
    </div>
  )
}
