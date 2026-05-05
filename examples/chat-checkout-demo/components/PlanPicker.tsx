import React from 'react'
import { useLocale, formatPrice, type Plan } from '@solvapay/react'
import { CheckCircleIcon } from './icons/CheckCircleIcon'

interface PlanPickerProps {
  plans: Plan[]
  selectedRef: string | null
  onSelect: (ref: string) => void
}

export const PlanPicker: React.FC<PlanPickerProps> = ({ plans, selectedRef, onSelect }) => {
  const locale = useLocale()

  return (
    <div>
      <h3 className="text-sm font-medium text-slate-900 mb-2">Choose a plan</h3>
      <div className="grid grid-cols-2 gap-3">
        {plans.map(plan => {
          const isSelected = plan.reference === selectedRef
          const price = formatPrice(plan.price ?? 0, plan.currency ?? 'USD', { locale })
          const interval = plan.billingCycle ?? plan.interval
          return (
            <button
              key={plan.reference}
              type="button"
              onClick={() => onSelect(plan.reference)}
              aria-pressed={isSelected}
              className={`relative p-4 rounded-xl border text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-300 ${
                isSelected
                  ? 'border-slate-900 bg-gradient-to-br from-white to-slate-50 shadow-sm ring-1 ring-slate-900/10'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              } hover:scale-[1.01] active:scale-[0.99]`}
            >
              {isSelected && (
                <span className="absolute top-2 right-2 text-emerald-600">
                  <CheckCircleIcon className="h-5 w-5" />
                </span>
              )}
              <div className="text-sm font-semibold text-slate-900 truncate pr-6">
                {plan.name ?? plan.reference}
              </div>
              <div className="text-lg font-semibold tracking-tight mt-1">{price}</div>
              {interval && <div className="text-xs text-slate-500 mt-0.5">{interval}</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
