'use client'

import { useCustomer } from '@solvapay/react'
import { TopupForm } from '@solvapay/react/primitives'
import { actionButtonClassName } from '../../components/ui/Button'
import '../../checkout/payment-form.css'

interface StyledTopupFormProps {
  amountCents: number
  currency: string
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
  creditsPerMinorUnit,
  displayExchangeRate,
  onSuccess,
  onError,
  onBack,
}: StyledTopupFormProps) {
  const customer = useCustomer()
  const exchangeRate = displayExchangeRate ?? 1

  return (
    <div className="space-y-6">
      <div className="pb-6 border-b border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-slate-600">Top-up type:</span>
          <span className="text-sm font-medium text-slate-900">Credit Top-Up</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-600">Amount:</span>
          <div className="text-right">
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
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-slate-900">Customer</h2>
        <div className="space-y-3">
          <div>
            <div className="text-xs text-slate-500 mb-1">Email</div>
            <div className="text-sm text-slate-900">{customer.email || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Name</div>
            <div className="text-sm text-slate-900">{customer.name || '—'}</div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-slate-900">Payment</h2>

        <TopupForm.Root
          amount={amountCents}
          currency={currency}
          onSuccess={onSuccess}
          onError={onError}
          className="payment-form-wrapper space-y-4"
        >
          <TopupForm.PaymentElement />
          <TopupForm.Loading />
          <TopupForm.Error className="text-sm text-red-600" />
          <TopupForm.SubmitButton asChild>
            <button className={actionButtonClassName}>
              Pay {formatAmount(amountCents, currency)}
            </button>
          </TopupForm.SubmitButton>
        </TopupForm.Root>
      </div>

      <div className="pt-4 border-t border-slate-200 space-y-2">
        <p className="text-xs text-slate-400 text-center">Powered by SolvaPay</p>
        <div className="flex justify-center space-x-4 text-xs text-slate-400">
          <button className="hover:text-slate-600 transition-colors">Terms</button>
          <button className="hover:text-slate-600 transition-colors">Privacy</button>
        </div>
      </div>

      <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900 block">
        ← Change amount
      </button>
    </div>
  )
}
