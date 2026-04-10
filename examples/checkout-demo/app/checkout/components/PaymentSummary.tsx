import type { Plan } from '@solvapay/react'
import { formatPrice, formatCreditsPerUnit, isUsageBasedPlan } from '../utils/planHelpers'

interface PaymentSummaryProps {
  selectedPlan: Plan | null
  className?: string
}

export function PaymentSummary({ selectedPlan, className = '' }: PaymentSummaryProps) {
  if (!selectedPlan) return null

  if (isUsageBasedPlan(selectedPlan)) {
    const creditCost = formatCreditsPerUnit(selectedPlan.creditsPerUnit)
    const unit = selectedPlan.measures || 'use'
    return (
      <div className={`flex justify-between items-center ${className}`}>
        <span className="text-sm font-medium text-slate-900">Pricing</span>
        <span className="text-base font-bold text-slate-900">{creditCost} credits / {unit}</span>
      </div>
    )
  }

  const price = formatPrice(selectedPlan.price)

  return (
    <div className={`flex justify-between items-center ${className}`}>
      <span className="text-sm font-medium text-slate-900">Total</span>
      <span className="text-xl font-bold text-slate-900">${price}</span>
    </div>
  )
}
