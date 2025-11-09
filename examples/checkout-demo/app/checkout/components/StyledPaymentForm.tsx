'use client'
import { PaymentForm, useCustomer, type Plan } from '@solvapay/react'
import { formatPrice } from '../utils/planHelpers'
import '../payment-form.css'

interface StyledPaymentFormProps {
  currentPlan: Plan
  agentRef?: string
  onSuccess: (paymentIntent?: any) => void
  onError: (error: Error) => void
  onBack: () => void
}

/**
 * Styled Payment Form Component
 *
 * Wraps the headless PaymentForm SDK component with full styling and structure.
 * Demonstrates how to style the SDK components in your own application.
 */
export function StyledPaymentForm({
  currentPlan,
  agentRef,
  onSuccess,
  onError,
  onBack,
}: StyledPaymentFormProps) {
  const price = formatPrice(currentPlan.price)
  const customer = useCustomer()

  return (
    <div className="space-y-6">
      {/* Plan Summary */}
      <div className="pb-6 border-b border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-slate-600">Selected Plan:</span>
          <span className="text-sm font-medium text-slate-900">{currentPlan.name}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-600">Total:</span>
          <span className="text-lg font-bold text-slate-900">${price}</span>
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

        <PaymentForm
          key={currentPlan.reference}
          planRef={currentPlan.reference}
          agentRef={agentRef}
          onSuccess={onSuccess}
          onError={onError}
          submitButtonText="Complete Purchase"
          className="space-y-6 payment-form-wrapper"
          buttonClassName="w-full py-2.5 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
        ← Back to plan selection
      </button>
    </div>
  )
}
