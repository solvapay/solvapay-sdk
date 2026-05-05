import React, { useState } from 'react'
import { TopupForm } from '@solvapay/react/primitives'
import { useBalance } from '@solvapay/react'
import { CheckCircleIcon } from './icons/CheckCircleIcon'
import { LockIcon } from './icons/LockIcon'
import { TopUpAmount, TopUpSelection as SelectionType } from '../types'
import { TopUpSelection } from './TopUpSelection'

interface TopUpFormProps {
  onSuccess: (selection: SelectionType) => void
}

const priceFor = (amount: TopUpAmount) => (amount === 100 ? 2.0 : 4.0)
const centsFor = (amount: TopUpAmount) => Math.round(priceFor(amount) * 100)

export const TopUpForm: React.FC<TopUpFormProps> = ({ onSuccess }) => {
  const [step, setStep] = useState<'select' | 'confirm' | 'success'>('select')
  const [selection, setSelection] = useState<SelectionType>({
    amount: 200,
    autoTopUpEnabled: true,
  })
  const [error, setError] = useState<string | null>(null)
  const { displayCurrency } = useBalance()
  const currency = (displayCurrency || 'USD').toUpperCase()

  const handlePaid = () => {
    setStep('success')
    window.setTimeout(() => onSuccess(selection), 1500)
  }

  const handleError = (e: Error) => {
    console.error('[TopUpForm] payment error:', e)
    setError(e.message)
  }

  if (step === 'success') {
    return (
      <div className="px-4 py-6">
        <div className="max-w-2xl mx-auto">
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-emerald-100 border border-emerald-200">
              <CheckCircleIcon className="h-6 w-6 text-emerald-700" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mt-3">Credits added</h2>
            <p className="text-slate-500 mt-1">
              {selection.amount} credits have been added to your account.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (step === 'select') {
    return (
      <div className="px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200/60 p-5">
            <TopUpSelection
              initial={selection}
              onContinue={sel => {
                setSelection(sel)
                setStep('confirm')
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200/60 p-5">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Add Credits</h2>
          <p className="text-sm text-slate-600 mb-4">
            Pay ${priceFor(selection.amount).toFixed(2)} to add {selection.amount} credits.
          </p>

          <div className="mb-5 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200/70">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  ${priceFor(selection.amount).toFixed(2)}
                </h3>
                <p className="text-xs text-slate-600">
                  {selection.amount} credits • Instant top-up
                </p>
              </div>
              <div className="text-right">
                <div className="text-sm text-slate-500">{currency}</div>
              </div>
            </div>
          </div>

          <TopupForm.Root
            amount={centsFor(selection.amount)}
            currency={currency}
            onSuccess={handlePaid}
            onError={handleError}
          >
            <div className="space-y-4">
              <TopupForm.PaymentElement />
              <div className="flex items-center justify-end text-xs text-slate-500">
                <LockIcon className="h-3.5 w-3.5 mr-1" />
                Secured by Stripe
              </div>
            </div>

            <TopupForm.Error className="mt-3 text-sm text-red-600" />

            <div className="mt-5">
              <TopupForm.SubmitButton asChild>
                <button className="group w-full flex justify-center items-center py-2.5 px-4 rounded-full text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                  Pay ${priceFor(selection.amount).toFixed(2)}
                </button>
              </TopupForm.SubmitButton>
            </div>
          </TopupForm.Root>

          <button
            onClick={() => setStep('select')}
            className="mt-4 text-sm text-slate-600 hover:text-slate-900 block"
          >
            ← Change amount
          </button>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  )
}
