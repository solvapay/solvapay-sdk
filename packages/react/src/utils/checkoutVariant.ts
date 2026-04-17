import type { Plan } from '../types'

/**
 * Checkout "shape" — drives the mandate variant, the submit-button CTA, and
 * the button `aria-label` in lockstep so those three strings always agree.
 */
export type CheckoutVariant = 'recurring' | 'oneTime' | 'topup' | 'usageMetered'

/**
 * Derive the variant from the plan's type + billing model. Unknown or missing
 * plans default to `'oneTime'`, which matches the canonical "Pay Now" UX.
 */
export function deriveVariant(
  plan: Plan | null | undefined,
  mode?: 'topup',
): CheckoutVariant {
  if (mode === 'topup') return 'topup'
  if (!plan?.type) return 'oneTime'

  switch (plan.type) {
    case 'recurring':
      return 'recurring'
    case 'usage-based':
      return plan.billingModel === 'post-paid' ? 'usageMetered' : 'topup'
    case 'one-time':
    default:
      return 'oneTime'
  }
}
