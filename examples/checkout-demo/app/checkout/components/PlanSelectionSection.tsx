import type { Plan } from '@solvapay/react';
import { formatPrice, isFreePlan } from '../utils/planHelpers';

interface PlanSelectionSectionProps {
  plans: Plan[];
  selectedPlanIndex: number;
  activePlanName: string | null;
  onSelectPlan: (index: number) => void;
  className?: string;
}

/**
 * Plan Selection Section Component
 * 
 * Displays plan cards in a grid with selection state
 */
export function PlanSelectionSection({
  plans,
  selectedPlanIndex,
  activePlanName,
  onSelectPlan,
  className = '',
}: PlanSelectionSectionProps) {
  return (
    <div className={`grid grid-cols-2 gap-4 ${className}`}>
      {plans.map((plan, index) => {
        const isFree = isFreePlan(plan);
        const isCurrentPlan = plan.name === activePlanName;
        const isSelected = !isFree && selectedPlanIndex === index;
        const planPrice = formatPrice(plan.price);

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
                onSelectPlan(index);
              }
            }}
          >
            {/* Selection Checkmark */}
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

            {/* Current Plan Badge */}
            {isCurrentPlan && (
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-medium px-3 py-1 rounded-full">
                Current Plan
              </div>
            )}

            {/* Popular Badge (for second non-free plan) */}
            {!isCurrentPlan && index === 1 && !isFree && (
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                Popular
              </div>
            )}

            {/* Plan Price and Name */}
            <div className="text-2xl font-bold text-slate-900 mb-1">${planPrice}</div>
            <div className="text-sm text-slate-600">{plan.name}</div>
          </div>
        );
      })}
    </div>
  );
}

