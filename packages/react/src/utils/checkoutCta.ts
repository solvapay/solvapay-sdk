import type { Plan, Product } from '../types'
import type { SolvaPayCopy } from '../i18n/types'
import { interpolate } from '../i18n/interpolate'
import type { CheckoutVariant } from './checkoutVariant'

export type ResolveCtaInput = {
  variant: CheckoutVariant
  plan?: Plan | null
  product?: Product | null
  amountFormatted: string
  copy: SolvaPayCopy
  /** Caller-provided override; short-circuits derivation. */
  override?: string
}

/**
 * Build the submit-button label. Keeps the mapping between plan type and CTA
 * in one place so the button, the aria-label, and `<MandateText>` agree.
 */
export function resolveCta(input: ResolveCtaInput): string {
  if (input.override) return input.override

  const { variant, plan, product, amountFormatted, copy } = input

  if (variant === 'recurring') {
    if (plan?.trialDays && plan.trialDays > 0) {
      return interpolate(copy.cta.trialStart, { trialDays: plan.trialDays })
    }
    return copy.cta.subscribe
  }

  if (variant === 'oneTime') {
    return interpolate(copy.cta.payAmount, { amount: amountFormatted })
  }

  if (variant === 'topup') {
    return interpolate(copy.cta.addAmount, { amount: amountFormatted })
  }

  if (variant === 'usageMetered') {
    return interpolate(copy.cta.startUsing, { product: product?.name ?? 'service' })
  }

  return copy.cta.payNow
}
