'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useBalance } from '@solvapay/react'
import { AmountPicker } from '@solvapay/react/primitives'
import { StyledTopupForm } from './components/StyledTopupForm'

export default function TopupPage() {
  const { adjustBalance, creditsPerMinorUnit, displayCurrency, displayExchangeRate } = useBalance()
  const currency = displayCurrency || 'USD'
  const [amount, setAmount] = useState<number | null>(null)
  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [paymentFailed, setPaymentFailed] = useState(false)

  const handlePaymentSuccess = () => {
    setPaymentSuccess(true)
    if (amountCents) {
      adjustBalance(amountCents * (creditsPerMinorUnit ?? 100))
    }
  }

  const handlePaymentError = (err: Error) => {
    console.error('[TopupPage] Payment error:', err.message)
    setPaymentFailed(true)
  }

  const handleBack = () => {
    setAmountCents(null)
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link href="/" className="text-slate-600 hover:text-slate-900 mb-8 inline-block">
          ← Back
        </Link>

        {paymentFailed ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Top-up failed</h2>
            <p className="text-slate-600 mb-6">
              Something went wrong processing your payment. Please try again.
            </p>
            <button
              onClick={() => {
                setPaymentFailed(false)
                setAmountCents(null)
              }}
              className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : paymentSuccess ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-emerald-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Top-up successful!</h2>
            <p className="text-slate-600 mb-6">Your credits have been added to your account.</p>
            <Link
              href="/"
              className="inline-block px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <h2 className="text-xl font-semibold text-slate-900 mb-8">Top up credits</h2>

            {amountCents === null ? (
              <div className="space-y-6">
                <AmountPicker.Root currency={currency} onChange={setAmount}>
                  <div className="grid grid-cols-4 gap-2">
                    <AmountPicker.Option amount={10} />
                    <AmountPicker.Option amount={50} />
                    <AmountPicker.Option amount={100} />
                    <AmountPicker.Option amount={500} />
                  </div>
                  <AmountPicker.Custom className="w-full rounded-lg border border-slate-300 px-4 py-3 text-base" />
                </AmountPicker.Root>
                <button
                  type="button"
                  disabled={!amount || amount < 1}
                  onClick={() => {
                    if (amount && amount >= 1) setAmountCents(Math.round(amount * 100))
                  }}
                  className="w-full px-6 py-3 rounded-lg bg-slate-900 text-white font-semibold disabled:bg-slate-300 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
                >
                  Continue to payment
                </button>
              </div>
            ) : (
              <StyledTopupForm
                amountCents={amountCents}
                currency={currency}
                creditsPerMinorUnit={creditsPerMinorUnit}
                displayExchangeRate={displayExchangeRate}
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
                onBack={handleBack}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
