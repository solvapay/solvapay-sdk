import { headlineCharges, type PricingOptionLike } from '@solvapay/core'

export type PlanPricingOption = {
  currency: string
  price: number
  basePrice?: number
  setupFee?: number
  default?: boolean
}

/**
 * The pricing-bearing subset of a plan. Structural rather than the full
 * `Plan` so the MCP checkout's `BootstrapPlanLike` can be priced by the
 * same resolver without a cast.
 */
export type PricedPlanLike = {
  currency?: string
  price?: number
  options?: PricingOptionLike[]
  pricingOptions?: PlanPricingOption[]
}

/**
 * The currencies a plan can be bought in.
 *
 * A multi-currency plan expresses this as one flat charge per currency
 * in `options[]` — the backend does not send a `pricingOptions` array,
 * and its derived top-level `price` collapses the plan to its default
 * currency. `pricingOptions` is still honoured first so an integrator
 * supplying plans through a custom fetcher can shape them directly.
 */
export function getPlanPricingOptions(plan: PricedPlanLike): PlanPricingOption[] {
  if (plan.pricingOptions && plan.pricingOptions.length > 0) {
    return plan.pricingOptions
  }

  const defaultCurrency = (plan.currency ?? 'USD').toUpperCase()
  const charges = headlineCharges(plan)
  if (charges.length > 0) {
    return charges.map(charge => ({
      currency: charge.currency,
      price: charge.amountMinor,
      default: charge.currency.toUpperCase() === defaultCurrency,
    }))
  }

  return [
    {
      currency: plan.currency ?? 'USD',
      price: plan.price ?? 0,
      default: true,
    },
  ]
}

export function resolvePlanPricingOption(
  plan: PricedPlanLike,
  currency?: string | null,
): PlanPricingOption {
  const options = getPlanPricingOptions(plan)
  if (currency) {
    const match = options.find(option => option.currency.toUpperCase() === currency.toUpperCase())
    if (match) return match
  }
  return options.find(option => option.default) ?? options[0]
}
