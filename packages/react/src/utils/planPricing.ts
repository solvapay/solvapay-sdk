import type { Plan } from '../types'

export type PlanPricingOption = {
  currency: string
  price: number
  basePrice?: number
  setupFee?: number
  default?: boolean
}

export function getPlanPricingOptions(plan: Plan): PlanPricingOption[] {
  if (plan.pricingOptions && plan.pricingOptions.length > 0) {
    return plan.pricingOptions
  }

  return [
    {
      currency: plan.currency ?? 'USD',
      price: plan.price ?? 0,
      default: true,
    },
  ]
}

export function resolvePlanPricingOption(plan: Plan, currency?: string | null): PlanPricingOption {
  const options = getPlanPricingOptions(plan)
  if (currency) {
    const match = options.find(option => option.currency.toUpperCase() === currency.toUpperCase())
    if (match) return match
  }
  return options.find(option => option.default) ?? options[0]
}
