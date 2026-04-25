/**
 * Shared defaults for Stripe's `PaymentElement` used by every SolvaPay
 * primitive (`TopupForm.PaymentElement`, `PaymentForm.PaymentElement`).
 *
 * We surface our own "Save card for future top-ups" UX, so Stripe Link's
 * sign-in banner and the "Save my information for faster checkout"
 * enrollment form would duplicate that affordance. Disabling Link by
 * default keeps every call site (MCP views, PaywallNotice, example apps,
 * third-party consumers) consistent without requiring each one to pass
 * `options={{ wallets: { link: 'never' } }}` by hand.
 *
 * Callers can always override via the `options` prop on the slot, e.g.
 * `options={{ wallets: { link: 'auto' } }}` to re-enable Link, or
 * `options={{ wallets: { applePay: 'never' } }}` which composes with the
 * default (both `link: 'never'` and `applePay: 'never'` reach Stripe).
 */
import type { PaymentElement as StripePaymentElement } from '@stripe/react-stripe-js'
import type { ComponentProps } from 'react'

type PaymentElementOptions = ComponentProps<typeof StripePaymentElement>['options']

export const DEFAULT_PAYMENT_ELEMENT_OPTIONS = {
  wallets: { link: 'never' },
} satisfies PaymentElementOptions

/**
 * Merge caller-supplied `options` on top of the SolvaPay defaults.
 *
 * The merge is shallow at the top level, but `wallets` is merged one
 * level deep so the caller's `applePay` / `googlePay` choices compose
 * with the default `link` setting instead of clobbering it.
 */
export function withPaymentElementDefaults(
  options?: PaymentElementOptions,
): PaymentElementOptions {
  return {
    ...options,
    wallets: {
      ...DEFAULT_PAYMENT_ELEMENT_OPTIONS.wallets,
      ...options?.wallets,
    },
  }
}
