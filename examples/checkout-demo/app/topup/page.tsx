'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useBalance } from '@solvapay/react'
import { AmountSelector } from './components/AmountSelector'
import { StyledTopupForm } from './components/StyledTopupForm'

export default function TopupPage() {
  const { adjustBalance, creditsPerMinorUnit } = useBalance()
  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [paymentFailed, setPaymentFailed] = useState(false)

  const handlePaymentSuccess = () => {
    setPaymentSuccess(true)
    if (amountCents) {
      adjustBalance(amountCents)
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
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
              <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Top-up successful!</h2>
            <p className="text-slate-600 mb-6">
              Your credits have been added to your account.
            </p>
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
              <AmountSelector onSelect={setAmountCents} creditsPerMinorUnit={creditsPerMinorUnit} />
            ) : (
              <StyledTopupForm
                amountCents={amountCents}
                creditsPerMinorUnit={creditsPerMinorUnit}
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
