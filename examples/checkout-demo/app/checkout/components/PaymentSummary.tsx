import type { Plan } from '@solvapay/react'
import { formatPrice } from '../utils/planHelpers'

interface PaymentSummaryProps {
  selectedPlan: Plan | null
  className?: string
}

/**
 * Payment Summary Component
 *
 * Displays the selected plan and total price in a clean format
 */
export function PaymentSummary({ selectedPlan, className = '' }: PaymentSummaryProps) {
  if (!selectedPlan) return null

  const price = formatPrice(selectedPlan.price)

  return (
    <div className={`flex justify-between items-center ${className}`}>
      <span className="text-sm font-medium text-slate-900">Total</span>
      <span className="text-xl font-bold text-slate-900">${price}</span>
    </div>
  )
}
