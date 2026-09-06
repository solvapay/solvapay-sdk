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
 * We also collect billing country (and required state / postal) ourselves
 * so tax attach and confirm see one SolvaPay-owned value. Stripe's
 * address fields would ask for country a second time and never reach
 * `customerCountry`.
 *
 * `layout: tabs` drops Stripe's one-item accordion header when only card
 * is available, and shows real tabs when there is more than one method.
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
  fields: { billingDetails: { address: 'never' } },
  layout: { type: 'tabs' },
} satisfies PaymentElementOptions

/**
 * Merge caller-supplied `options` on top of the SolvaPay defaults.
 *
 * The merge is shallow at the top level. `wallets` and `fields` (and
 * `fields.billingDetails`) are merged one level deeper so a caller
 * passing `fields` or `wallets.applePay` composes with the defaults
 * instead of clobbering them.
 */
export function withPaymentElementDefaults(
  options?: PaymentElementOptions,
): PaymentElementOptions {
  const defaultBilling = DEFAULT_PAYMENT_ELEMENT_OPTIONS.fields.billingDetails
  const callerBilling = options?.fields?.billingDetails
  const billingDetails =
    callerBilling && typeof callerBilling === 'object'
      ? { ...defaultBilling, ...callerBilling }
      : (callerBilling ?? defaultBilling)

  return {
    ...DEFAULT_PAYMENT_ELEMENT_OPTIONS,
    ...options,
    wallets: {
      ...DEFAULT_PAYMENT_ELEMENT_OPTIONS.wallets,
      ...options?.wallets,
    },
    fields: {
      ...DEFAULT_PAYMENT_ELEMENT_OPTIONS.fields,
      ...options?.fields,
      billingDetails,
    },
  }
}
