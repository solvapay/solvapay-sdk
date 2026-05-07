import React from 'react'
import { CheckoutSteps, PlanSelector } from '@solvapay/react/primitives'
import { PaywallNotice } from '@solvapay/react/primitives'
import type { PaywallStructuredContent } from '@solvapay/server'
import { DrawerHeader } from './DrawerHeader'
import { PreCheckoutNotice } from './PreCheckoutNotice'
import { ScenarioType } from '../types'

export type InlineCheckoutMode =
  | { mode: 'paywall'; stage: 'notice' | 'checkout'; content: PaywallStructuredContent }
  | { mode: 'upgrade'; productRef: string }

interface InlineCheckoutProps {
  /**
   * Discriminated state for the drawer:
   *  - `paywall` + `stage: 'notice'`: the server returned a 402 —
   *    render the inline pre-checkout strip first (educational moment
   *    with scenario-tailored heading + bullets + CTA).
   *  - `paywall` + `stage: 'checkout'`: user clicked the CTA — render
   *    the SDK's paywall surface with `<PaywallNotice.EmbeddedCheckout>`
   *    so the Heading + Message reflect the real gate reason.
   *  - `upgrade`: user clicked "Upgrade" before hitting a 402 — go
   *    straight to the stepped checkout primitive with no
   *    paywall-flavored copy.
   */
  state: InlineCheckoutMode
  /** Active scenario tab — drives the pre-checkout notice copy. */
  currentScenario: ScenarioType
  /**
   * Fired once the customer's entitlement matches what was needed —
   * either via `usePaywallResolver.resolved` (paywall path) or via
   * `useCheckoutFlow#onPurchaseSuccess` (proactive upgrade path).
   * The parent uses this to dismiss the drawer and replay the
   * pending message.
   */
  onSuccess: () => void
  /**
   * Click handler for the pre-checkout notice CTA. Flips the drawer
   * from `stage: 'notice'` to `stage: 'checkout'` so the embedded
   * checkout mounts. Owned by the parent so the same callback can
   * gate any future entry points without duplicating state here.
   */
  onUnlock: () => void
  /** Optional return URL forwarded to Stripe's confirmPayment step. */
  returnUrl?: string
}

/**
 * Inline checkout drawer rendered below the chat transcript. Three
 * shapes share the drawer slot:
 *
 *  - `paywall` + `stage: 'notice'` → `<PreCheckoutNotice>` strip
 *    (scenario-tailored heading + bullets + CTA). Click expands into
 *    the next stage. No drawer chrome — the strip is its own surface.
 *  - `paywall` + `stage: 'checkout'` → `<PaywallNotice.Root>` +
 *    `Heading` + `Message` + `<PaywallNotice.EmbeddedCheckout>`. The
 *    notice resolves web-friendly copy via the SDK's i18n bundle and
 *    the embedded checkout is a stepped `<CheckoutSteps.*>`
 *    composition under the hood.
 *  - `upgrade` → bare `<CheckoutSteps.*>` composition. No paywall
 *    chrome because the user proactively chose to upgrade — they
 *    don't need to be told why a gate appeared, and they shouldn't
 *    sit through a notice they triggered themselves.
 */
export const InlineCheckout: React.FC<InlineCheckoutProps> = ({
  state,
  currentScenario,
  onSuccess,
  onUnlock,
  returnUrl,
}) => {
  const url = returnUrl ?? (typeof window !== 'undefined' ? window.location.href : '/')

  if (state.mode === 'paywall' && state.stage === 'notice') {
    // The strip is its own bordered surface — render it bare without
    // the drawer chrome so the educational moment doesn't feel like
    // an already-opened form.
    return (
      <PreCheckoutNotice
        currentScenario={currentScenario}
        productRef={state.content.product ?? ''}
        paywallContent={state.content}
        onUnlock={onUnlock}
      />
    )
  }

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
