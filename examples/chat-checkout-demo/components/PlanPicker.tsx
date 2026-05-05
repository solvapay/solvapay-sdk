import React from 'react'
import { useLocale, formatPrice, usePurchase, type Plan } from '@solvapay/react'
import { CheckCircleIcon } from './icons/CheckCircleIcon'

interface PlanPickerProps {
  plans: Plan[]
  selectedRef: string | null
  onSelect: (ref: string) => void
}

/**
 * Plan picker.
 *
 * - Free plans (`requiresPayment === false` or `price === 0`) render
 *   as non-interactive cards. Selecting "Free" inside an upgrade flow
 *   has no payable outcome, so we don't let users do it.
 * - The customer's currently-active plan gets a `Current` pill. For
 *   paid plans, that's the plan referenced by the active purchase. For
 *   free plans, "current" is `isFree && no paid purchase exists`.
 */
export const PlanPicker: React.FC<PlanPickerProps> = ({ plans, selectedRef, onSelect }) => {
  const locale = useLocale()
  const { activePurchase, hasPaidPurchase } = usePurchase()
  const currentPaidPlanRef = activePurchase?.planSnapshot?.reference

  return (
    <div>
      <h3 className="text-sm font-medium text-slate-900 mb-2">Choose a plan</h3>
      <div className="grid grid-cols-2 gap-3">
        {plans.map(plan => {
          const isFree = plan.requiresPayment === false || (plan.price ?? 0) === 0
          const isSelected = plan.reference === selectedRef
          const isCurrent = isFree
            ? !hasPaidPurchase
            : Boolean(currentPaidPlanRef && currentPaidPlanRef === plan.reference)
          const isInteractive = !isFree && !isCurrent
          const price = formatPrice(plan.price ?? 0, plan.currency ?? 'USD', { locale })
          const interval = plan.billingCycle ?? plan.interval
          // Avoid surfacing raw `pln_xxx` references in the UI when a plan
          // hasn't been given a name in the dashboard.
          const friendlyName = plan.name ?? (isFree ? 'Free plan' : 'Plan')

          const baseClass = 'relative p-4 rounded-xl border text-left transition-all duration-200'
          const interactiveClass = `${baseClass} cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-300 hover:scale-[1.01] active:scale-[0.99] ${
            isSelected
              ? 'border-slate-900 bg-gradient-to-br from-white to-slate-50 shadow-sm ring-1 ring-slate-900/10'
              : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
          }`
          const inertClass = `${baseClass} cursor-not-allowed opacity-70 ${
            isCurrent
              ? 'border-emerald-200 bg-emerald-50/40'
              : 'border-slate-200 bg-slate-50/60'
          }`

          const className = isInteractive ? interactiveClass : inertClass

          const content = (
            <>
              {isCurrent && (
                <span className="absolute -top-2 left-3 px-2 py-0.5 text-[10px] font-medium rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200">
                  Current
                </span>
              )}
              {isSelected && !isCurrent && (
                <span className="absolute top-2 right-2 text-emerald-600">
                  <CheckCircleIcon className="h-5 w-5" />
                </span>
              )}
              <div className="text-sm font-semibold text-slate-900 truncate pr-6">
                {friendlyName}
              </div>
              <div className="text-lg font-semibold tracking-tight mt-1">{price}</div>
              {interval && <div className="text-xs text-slate-500 mt-0.5">{interval}</div>}
            </>
          )

          if (!isInteractive) {
            return (
              <div
                key={plan.reference}
                aria-disabled="true"
                className={className}
                title={isFree ? 'Free plan — nothing to purchase' : 'You are on this plan'}
              >
                {content}
              </div>
            )
          }

          return (
            <button
              key={plan.reference}
              type="button"
              onClick={() => onSelect(plan.reference)}
              aria-pressed={isSelected}
              className={className}
            >
              {content}
            </button>
          )
        })}
      </div>
    </div>
  )
}
