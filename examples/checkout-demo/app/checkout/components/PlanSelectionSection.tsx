import type { Plan } from '@solvapay/react'
import { formatPrice, formatPerUnitPrice, isFreePlan, isUsageBasedPlan } from '../utils/planHelpers'

interface PlanSelectionSectionProps {
  plans: Plan[]
  selectedPlanIndex: number
  activePlanIndex: number
  onSelectPlan: (index: number) => void
  className?: string
}

function PlanPricing({ plan }: { plan: Plan }) {
  if (isUsageBasedPlan(plan)) {
    const unitPrice = formatPerUnitPrice(plan.pricePerUnit)
    const unit = plan.measures || 'use'
    return (
      <>
        <div className="text-2xl font-bold text-slate-900 mb-1">${unitPrice}</div>
        <div className="text-sm text-slate-600">per {unit}</div>
        {plan.freeUnits ? (
          <div className="text-xs text-green-600 mt-2">{plan.freeUnits} free {unit}s included</div>
        ) : null}
      </>
    )
  }

  const planPrice = formatPrice(plan.price)
  const cycle = plan.interval || plan.billingCycle
  return (
    <>
      <div className="text-2xl font-bold text-slate-900 mb-1">${planPrice}</div>
      <div className="text-sm text-slate-600">{cycle ? `/${cycle}` : 'one-time'}</div>
    </>
  )
}

export function PlanSelectionSection({
  plans,
  selectedPlanIndex,
  activePlanIndex,
  onSelectPlan,
  className = '',
}: PlanSelectionSectionProps) {
  return (
    <div className={`grid grid-cols-2 gap-4 ${className}`}>
      {plans.map((plan, index) => {
        const isFree = isFreePlan(plan)
        const isCurrentPlan = activePlanIndex === index
        const isSelected = !isFree && selectedPlanIndex === index

        return (
          <div
            key={plan.reference}
            className={`relative p-6 border-2 rounded-xl transition-all ${
              isFree
                ? 'border-slate-200 bg-slate-50 cursor-not-allowed opacity-60'
                : isSelected
                  ? 'border-green-500 bg-white shadow-sm cursor-pointer'
                  : 'border-slate-200 bg-white hover:border-slate-300 cursor-pointer'
            }`}
            onClick={() => {
              if (!isFree) {
                onSelectPlan(index)
              }
            }}
          >
            {isSelected && (
              <div className="absolute top-2 right-2 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                <svg
                  className="w-3 h-3 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            )}

            {isCurrentPlan && (
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-medium px-3 py-1 rounded-full">
                Current
              </div>
            )}

            {!isCurrentPlan && index === 1 && !isFree && (
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                Popular
              </div>
            )}

            <PlanPricing plan={plan} />
          </div>
        )
      })}
    </div>
  )
}
