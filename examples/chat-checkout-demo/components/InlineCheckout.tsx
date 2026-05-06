import React from 'react'
import { PaywallNotice } from '@solvapay/react/primitives'
import type { PaywallStructuredContent } from '@solvapay/server'
import { DrawerHeader } from './DrawerHeader'

interface InlineCheckoutProps {
  /**
   * Either the structured content from a 402 response, or a synthetic
   * `payment_required` shape minted client-side when the user clicks
   * "Upgrade" before hitting the gate. Both flow through the same
   * `<PaywallNotice.EmbeddedCheckout>` composition.
   */
  paywallContent: PaywallStructuredContent
  /**
   * Fired once `usePaywallResolver` flips `resolved` to `true` —
   * either the customer completed payment, activated a plan, or now
   * has enough credits to cover the next request. The parent uses
   * this to dismiss the drawer and replay the pending message.
   */
  onSuccess: () => void
  /** Optional return URL forwarded to Stripe's confirmPayment step. */
  returnUrl?: string
}

/**
 * Inline checkout drawer rendered below the chat transcript. Wraps the
 * SDK's `<PaywallNotice>` primitive so the picker / payment form swap
 * branches automatically based on plan type (PAYG → AmountPicker +
 * TopupForm; recurring → PaymentForm). Replaces the demo's prior
 * scenario-specific forms (CheckoutForm / TopUpForm /
 * LifetimeAccessForm) with one unified composition.
 */
export const InlineCheckout: React.FC<InlineCheckoutProps> = ({
  paywallContent,
  onSuccess,
  returnUrl,
}) => {
  const url =
    returnUrl ?? (typeof window !== 'undefined' ? window.location.href : '/')

  return (
    <div className="px-4 py-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200/60 p-5">
          <DrawerHeader />
          <PaywallNotice.Root content={paywallContent} onResolved={onSuccess}>
            <PaywallNotice.Heading className="text-lg font-semibold text-slate-900 mb-1" />
            <PaywallNotice.Message className="text-sm text-slate-600 mb-4" />
            <PaywallNotice.EmbeddedCheckout returnUrl={url} />
          </PaywallNotice.Root>
        </div>
      </div>
    </div>
  )
}
