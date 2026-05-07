import React from 'react'
import { CheckoutSteps, PlanSelector } from '@solvapay/react/primitives'
import { PaywallNotice } from '@solvapay/react/primitives'
import type { PaywallStructuredContent } from '@solvapay/server'
import { DrawerHeader } from './DrawerHeader'

export type InlineCheckoutMode =
  | { mode: 'paywall'; content: PaywallStructuredContent }
  | { mode: 'upgrade'; productRef: string }

interface InlineCheckoutProps {
  /**
   * Discriminated state for the drawer:
   *  - `paywall`: the server returned a 402 — render the SDK's
   *    paywall surface with `<PaywallNotice.EmbeddedCheckout>` so the
   *    Heading + Message reflect the real gate reason.
   *  - `upgrade`: user clicked "Upgrade" before hitting a 402 — go
   *    straight to the stepped checkout primitive with no
   *    paywall-flavored copy.
   */
  state: InlineCheckoutMode
  /**
   * Fired once the customer's entitlement matches what was needed —
   * either via `usePaywallResolver.resolved` (paywall path) or via
   * `useCheckoutFlow#onPurchaseSuccess` (proactive upgrade path).
   * The parent uses this to dismiss the drawer and replay the
   * pending message.
   */
  onSuccess: () => void
  /** Optional return URL forwarded to Stripe's confirmPayment step. */
  returnUrl?: string
}

/**
 * Inline checkout drawer rendered below the chat transcript. Two
 * shapes share the same drawer chrome:
 *
 *  - `paywall` → `<PaywallNotice.Root>` + `Heading` + `Message` +
 *    `<PaywallNotice.EmbeddedCheckout>`. The notice resolves
 *    web-friendly copy via the SDK's i18n bundle and the embedded
 *    checkout is a stepped `<CheckoutSteps.*>` composition under the
 *    hood.
 *  - `upgrade` → bare `<CheckoutSteps.*>` composition. No paywall
 *    chrome because the user proactively chose to upgrade — they
 *    don't need to be told why a gate appeared.
 */
export const InlineCheckout: React.FC<InlineCheckoutProps> = ({ state, onSuccess, returnUrl }) => {
  const url = returnUrl ?? (typeof window !== 'undefined' ? window.location.href : '/')

  return (
    <div className="px-4 py-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200/60 p-5">
          <DrawerHeader />
          {state.mode === 'paywall' ? (
            <PaywallNotice.Root content={state.content} onResolved={onSuccess}>
              <PaywallNotice.Heading className="text-lg font-semibold text-slate-900 mb-1" />
              <PaywallNotice.Message className="text-sm text-slate-600 mb-4" />
              <PaywallNotice.EmbeddedCheckout returnUrl={url} />
            </PaywallNotice.Root>
          ) : (
            <CheckoutSteps.Root
              productRef={state.productRef}
              returnUrl={url}
              onPurchaseSuccess={onSuccess}
            >
              <h3 className="text-lg font-semibold text-slate-900 mb-1">Choose a plan</h3>
              <p className="text-sm text-slate-600 mb-4">Pick a plan to keep going.</p>
              <CheckoutSteps.IfStep step="plan">
                <CheckoutSteps.PlanGrid />
                <PlanSelector.Loading />
                <PlanSelector.Error />
                <CheckoutSteps.PlanContinueButton />
              </CheckoutSteps.IfStep>
              <CheckoutSteps.IfStep step="amount">
                <CheckoutSteps.BackLink />
                <CheckoutSteps.AmountPicker />
                <CheckoutSteps.AmountContinueButton />
              </CheckoutSteps.IfStep>
              <CheckoutSteps.IfStep step="payment">
                <CheckoutSteps.BackLink />
                <CheckoutSteps.Payment />
              </CheckoutSteps.IfStep>
              <CheckoutSteps.IfStep step="success">
                <CheckoutSteps.Success />
              </CheckoutSteps.IfStep>
            </CheckoutSteps.Root>
          )}
        </div>
      </div>
    </div>
  )
}
