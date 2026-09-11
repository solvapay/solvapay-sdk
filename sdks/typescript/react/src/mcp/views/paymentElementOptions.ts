/**
 * `PaymentElement` options shared by the MCP payment surfaces
 * (`McpTopupView`, `PaygPaymentStep`).
 *
 * Every MCP payment surface renders its own `<MandateText>` directly under
 * the submit button, so Stripe's built-in `terms` line would state the same
 * authorization a second time — in Stripe's wording, mid-form, between the
 * card fields and the country selector. We turn it off and let `MandateText`
 * carry the full mandate, including the saved-card sentence it adds when
 * auto-recharge is enabled (`savesPaymentMethod`).
 *
 * This is deliberately scoped to the MCP views rather than baked into
 * `DEFAULT_PAYMENT_ELEMENT_OPTIONS`: an integrator composing `TopupForm`
 * without `MandateText` still needs Stripe's line to stay compliant.
 */
import type { PaymentElement as StripePaymentElement } from '@stripe/react-stripe-js'
import type { ComponentProps } from 'react'

type PaymentElementOptions = ComponentProps<typeof StripePaymentElement>['options']

export const MCP_PAYMENT_ELEMENT_OPTIONS = {
  terms: { card: 'never' },
} satisfies PaymentElementOptions
