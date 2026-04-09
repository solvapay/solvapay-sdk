'use client'

import { TopupForm, useCustomer } from '@solvapay/react'
import { actionButtonClassName } from '../../components/ui/Button'
import '../../checkout/payment-form.css'

interface StyledTopupFormProps {
  amountCents: number
  creditsPerMinorUnit?: number | null
  onSuccess: () => void
  onError: (error: Error) => void
  onBack: () => void
}

function formatDollars(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function StyledTopupForm({
  amountCents,
  creditsPerMinorUnit,
  onSuccess,
  onError,
  onBack,
}: StyledTopupFormProps) {
  const customer = useCustomer()

  return (
    <div className="space-y-6">
      {/* Top-up Summary */}
      <div className="pb-6 border-b border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-slate-600">Top-up type:</span>
          <span className="text-sm font-medium text-slate-900">Credit Top-Up</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-600">Amount:</span>
          <div className="text-right">
            <span className="text-lg font-bold text-slate-900">${formatDollars(amountCents)}</span>
            {creditsPerMinorUnit != null && creditsPerMinorUnit > 0 && (
              <p className="text-sm text-slate-500">
                = {new Intl.NumberFormat().format(Math.floor(amountCents * creditsPerMinorUnit))} credits
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Customer Information */}
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

      {/* Payment Section */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-slate-900">Payment</h2>

        <TopupForm
          amount={amountCents}
          currency="USD"
          onSuccess={onSuccess}
          onError={onError}
          submitButtonText={`Pay $${formatDollars(amountCents)}`}
          className="space-y-6 payment-form-wrapper"
          buttonClassName={actionButtonClassName}
        />
      </div>

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
        ← Change amount
      </button>
    </div>
  )
}
