import type { Plan } from '../types'

/**
 * Checkout "shape" — drives the mandate variant, the submit-button CTA, and
 * the button `aria-label` in lockstep so those three strings always agree.
 */
export type CheckoutVariant =
  | 'recurring'
  | 'oneTime'
  | 'topup'
  | 'usageMetered'
  | 'freeTier'

/**
 * Derive the variant from the plan's type + billing model. Unknown or missing
 * plans default to `'oneTime'`, which matches the canonical "Pay Now" UX.
 *
 * Free plans (`requiresPayment === false`) that are NOT usage-metered route
 * to the `'freeTier'` variant. Metered free/usage plans stay on
 * `'usageMetered'` because the mandate copy there already covers pay-as-you-go.
 */
export function deriveVariant(
  plan: Plan | null | undefined,
  mode?: 'topup',
): CheckoutVariant {
  if (mode === 'topup') return 'topup'
  if (!plan?.type) return 'oneTime'

  if (plan.type === 'usage-based') {
    return plan.billingModel === 'post-paid' ? 'usageMetered' : 'topup'
  }

  if (plan.requiresPayment === false) return 'freeTier'

  switch (plan.type) {
    case 'recurring':
      return 'recurring'
    case 'one-time':
    default:
      return 'oneTime'
  }
}
