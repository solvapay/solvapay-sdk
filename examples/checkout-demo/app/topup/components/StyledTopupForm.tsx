'use client'

import { useCustomer } from '@solvapay/react'
import type { AutoRechargeInput } from '@solvapay/server'
import { TopupForm } from '@solvapay/react/primitives'
import { actionButtonClassName } from '../../components/ui/Button'

interface StyledTopupFormProps {
  amountCents: number
  currency: string
  autoRecharge?: AutoRechargeInput
  creditsPerMinorUnit?: number | null
  displayExchangeRate?: number | null
  onSuccess: () => void
  onError: (error: Error) => void
  onBack: () => void
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function StyledTopupForm({
  amountCents,
  currency,
  autoRecharge,
  creditsPerMinorUnit,
  displayExchangeRate,
  onSuccess,
  onError,
  onBack,
}: StyledTopupFormProps) {
  const customer = useCustomer()
  const exchangeRate = displayExchangeRate ?? 1

  return (
    <section className="space-y-6">
      <dl className="pb-6 border-b border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <dt className="text-sm text-slate-600">Top-up type:</dt>
          <dd className="text-sm font-medium text-slate-900">Credit Top-Up</dd>
        </div>
        <div className="flex justify-between items-center">
          <dt className="text-sm text-slate-600">Amount:</dt>
          <dd className="text-right">
            <span className="text-lg font-bold text-slate-900">
              {formatAmount(amountCents, currency)}
            </span>
            {creditsPerMinorUnit != null && creditsPerMinorUnit > 0 && (
              <p className="text-sm text-slate-500">
                {exchangeRate !== 1 ? '~' : '='}{' '}
                {new Intl.NumberFormat().format(
                  Math.floor((amountCents / exchangeRate) * creditsPerMinorUnit),
                )}{' '}
                credits
              </p>
            )}
          </dd>
        </div>
      </dl>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-900">Customer</h2>
        <dl className="space-y-3">
          <div>
            <dt className="text-xs text-slate-500 mb-1">Email</dt>
            <dd className="text-sm text-slate-900">{customer.email || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 mb-1">Name</dt>
            <dd className="text-sm text-slate-900">{customer.name || '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-900">Payment</h2>

        <TopupForm.Root
          amount={amountCents}
          currency={currency}
          autoRecharge={autoRecharge}
          onSuccess={onSuccess}
          onError={onError}
          className="space-y-4"
        >
          <TopupForm.PaymentElement />
          <TopupForm.BusinessDetails.Root>
            <TopupForm.BusinessDetails.Fields />
          </TopupForm.BusinessDetails.Root>
          <TopupForm.Summary.Root>
            <TopupForm.Summary.Rows />
          </TopupForm.Summary.Root>
          <TopupForm.Loading />
          <TopupForm.Error className="text-sm text-red-600" />
          <span className="solvapay-secure-note">Secure payment processed by Stripe</span>
          <TopupForm.SubmitButton asChild>
            <button className={actionButtonClassName}>
              Pay {formatAmount(amountCents, currency)}
            </button>
          </TopupForm.SubmitButton>
        </TopupForm.Root>
      </section>

      <footer className="pt-4 border-t border-slate-200 space-y-2">
        <p className="text-xs text-slate-400 text-center">Powered by SolvaPay</p>
        <nav className="flex justify-center space-x-4 text-xs text-slate-400">
          <button className="hover:text-slate-600 transition-colors">Terms</button>
          <button className="hover:text-slate-600 transition-colors">Privacy</button>
        </nav>
      </footer>

      <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 block">
        ← Change amount
      </button>
    </section>
  )
}
