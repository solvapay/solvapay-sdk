'use client'

import { useState } from 'react'
import type { Plan } from '@solvapay/react'
import { getAccessToken } from '../../lib/supabase'
import { formatPerUnitPrice } from '../utils/planHelpers'

type ActivationState = 'confirm' | 'activating' | 'success' | 'topup_required' | 'error'

interface ActivationSectionProps {
  currentPlan: Plan
  productRef?: string
  onSuccess: () => void
  onBack: () => void
}

export function ActivationSection({
  currentPlan,
  productRef,
  onSuccess,
  onBack,
}: ActivationSectionProps) {
  const [state, setState] = useState<ActivationState>('confirm')
  const [errorMessage, setErrorMessage] = useState<string>('')

  const unitPrice = formatPerUnitPrice(currentPlan.pricePerUnit)
  const unit = currentPlan.measures || 'use'
  const planLabel =
    typeof currentPlan.metadata?.name === 'string'
      ? currentPlan.metadata.name
      : currentPlan.reference

  const handleActivate = async () => {
    setState('activating')
    try {
      const accessToken = await getAccessToken()
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      }

      const res = await fetch('/api/activate-plan', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          productRef,
          planRef: currentPlan.reference,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Activation failed')
      }

      const data = await res.json()

      switch (data.status) {
        case 'activated':
        case 'already_active':
          setState('success')
          onSuccess()
          break
        case 'topup_required':
          setState('topup_required')
          break
        case 'payment_required':
          setErrorMessage('This plan requires payment. Please select a different plan.')
          setState('error')
          break
        case 'invalid':
          setErrorMessage(data.message || 'Invalid plan configuration.')
          setState('error')
          break
        default:
          setErrorMessage('Unexpected response from server.')
          setState('error')
      }
    } catch (err) {
      console.error('Activation failed:', err)
      setErrorMessage(err instanceof Error ? err.message : 'Activation failed')
      setState('error')
    }
  }

  if (state === 'success') {
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

  if (state === 'topup_required') {
    return (
      <div className="space-y-6">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-amber-900 mb-2">Credits needed</h3>
          <p className="text-sm text-amber-700">
            This plan requires a credit balance. Add credits to activate.
          </p>
          <button
            onClick={() => {
              // Could redirect to a top-up page in the future
              window.location.href = '/'
            }}
            className="mt-4 w-full py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium"
          >
            Add Credits
          </button>
        </div>
        <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 block">
          ← Back to plan selection
        </button>
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="space-y-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-sm text-red-700">{errorMessage}</p>
        </div>
        <button
          onClick={() => setState('confirm')}
          className="w-full py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium"
        >
          Try Again
        </button>
        <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 block">
          ← Back to plan selection
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-slate-900">Confirm your plan</h3>

      {/* Plan Summary */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
        <h4 className="text-sm font-medium text-slate-900">Plan Summary</h4>
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Plan</span>
          <span className="font-medium text-slate-900">{planLabel}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-600">Pricing</span>
          <span className="font-medium text-slate-900">${unitPrice} / {unit}</span>
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

      {/* Activate Button */}
      <button
        onClick={handleActivate}
        disabled={state === 'activating'}
        className="w-full py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {state === 'activating' ? (
          <>
            <svg
              className="animate-spin h-5 w-5 text-white"
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
            Activating...
          </>
        ) : (
          'Select Plan'
        )}
      </button>

      {/* Footer */}
      <div className="pt-4 border-t border-slate-200 space-y-2">
        <p className="text-xs text-slate-400 text-center">Powered by SolvaPay</p>
        <div className="flex justify-center space-x-4 text-xs text-slate-400">
          <button className="hover:text-slate-600 transition-colors">Terms</button>
          <button className="hover:text-slate-600 transition-colors">Privacy</button>
        </div>
      </div>

      {/* Back Button */}
      <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 block">
        ← Back to plan selection
      </button>
    </div>
  )
}
