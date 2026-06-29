'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { AutoRechargeInput } from '@solvapay/server'
import { AutoRecharge, configToAutoRechargeInput, useAutoRecharge, useBalance } from '@solvapay/react'
import { AmountPicker } from '@solvapay/react/primitives'
import { StyledTopupForm } from './components/StyledTopupForm'

export default function TopupPage() {
  const { refetch, creditsPerMinorUnit, displayCurrency, displayExchangeRate } = useBalance()
  const { config: savedAutoRechargeConfig, refresh: refreshAutoRecharge } = useAutoRecharge()
  const currency = displayCurrency || 'USD'
  const [amount, setAmount] = useState<number | null>(null)
  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [pendingAutoRecharge, setPendingAutoRecharge] = useState<AutoRechargeInput | null>(null)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [paymentFailed, setPaymentFailed] = useState(false)

  const paymentAutoRecharge = useMemo((): AutoRechargeInput | undefined => {
    if (pendingAutoRecharge) return pendingAutoRecharge
    if (!savedAutoRechargeConfig?.enabled) return undefined
    return (
      configToAutoRechargeInput(savedAutoRechargeConfig, {
        currency,
        conversion: { creditsPerMinorUnit, displayExchangeRate },
      }) ?? undefined
    )
  }, [
    pendingAutoRecharge,
    savedAutoRechargeConfig,
    currency,
    creditsPerMinorUnit,
    displayExchangeRate,
  ])

  const handlePaymentSuccess = () => {
    setPaymentSuccess(true)
    void refetch()
    void refreshAutoRecharge(true)
  }

  const handlePaymentError = (err: Error) => {
    console.error('[TopupPage] Payment error:', err.message)
    setPaymentFailed(true)
  }

  const handleBack = () => {
    setAmount(null)
    setAmountCents(null)
  }

  return (
    <main className="min-h-screen bg-white">
      <section className="max-w-2xl mx-auto px-6 py-12">
        <Link href="/" className="text-slate-600 hover:text-slate-900 mb-8 inline-block">
          ← Back
        </Link>

        {paymentFailed ? (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
            <p
              className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center"
              aria-hidden="true"
            >
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
            </p>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Top-up failed</h2>
            <p className="text-slate-600 mb-6">
              Something went wrong processing your payment. Please try again.
            </p>
            <button
              type="button"
              onClick={() => {
                setPaymentFailed(false)
                setAmount(null)
                setAmountCents(null)
              }}
              className="px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              Try Again
            </button>
          </section>
        ) : paymentSuccess ? (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
            <p
              className="w-12 h-12 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center"
              aria-hidden="true"
            >
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
            </p>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Top-up successful!</h2>
            <p className="text-slate-600 mb-6">Your credits have been added to your account.</p>
            <Link
              href="/"
              className="inline-block px-6 py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              Back to Dashboard
            </Link>
          </section>
        ) : (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <header className="mb-8">
              <h2 className="text-xl font-semibold text-slate-900">Top up credits</h2>
            </header>

            {amountCents === null ? (
              <section className="space-y-6">
                <AmountPicker.Root currency={currency} onChange={setAmount}>
                  <menu className="grid grid-cols-4 gap-2 list-none p-0 m-0">
                    <li>
                      <AmountPicker.Option amount={10} />
                    </li>
                    <li>
                      <AmountPicker.Option amount={50} />
                    </li>
                    <li>
                      <AmountPicker.Option amount={100} />
                    </li>
                    <li>
                      <AmountPicker.Option amount={500} />
                    </li>
                  </menu>
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
                <AutoRecharge
                  currency={currency}
                  deferCardSetup
                  onPendingConfig={setPendingAutoRecharge}
                />
              </section>
            ) : (
              <StyledTopupForm
                amountCents={amountCents}
                currency={currency}
                autoRecharge={paymentAutoRecharge}
                creditsPerMinorUnit={creditsPerMinorUnit}
                displayExchangeRate={displayExchangeRate}
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
                onBack={handleBack}
              />
            )}
          </section>
        )}
      </section>
    </main>
  )
}
