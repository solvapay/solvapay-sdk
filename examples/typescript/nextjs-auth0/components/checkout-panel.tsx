'use client'

import { CheckoutSteps, PlanSelector } from '@solvapay/react/primitives'
import type { SuccessMeta } from '@solvapay/react/primitives'

const buttonClassName =
  'w-full mt-4 inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50'

const backLinkClassName = 'mb-4 inline-block text-sm text-muted-foreground hover:text-foreground'

/**
 * Embedded (not hosted) checkout for the Pay As You Go plan.
 *
 * Built on the SDK's `CheckoutSteps` engine: plan → amount (PAYG credit
 * top-up) → embedded Stripe payment element → success. Everything renders
 * inline — there is no redirect to a hosted SolvaPay checkout page. The
 * `productRef` comes from `NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF`; the publishable
 * key and client secret are returned by `/api/create-payment-intent`.
 */
export function CheckoutPanel({ onPurchased }: { onPurchased: () => void }) {
  const productRef = process.env.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF

  if (!productRef) {
    return (
      <p className="text-sm text-destructive">
        Missing <code>NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF</code> environment variable.
      </p>
    )
  }

  const returnUrl = typeof window !== 'undefined' ? window.location.href : ''

  const handleSuccess = (_meta: SuccessMeta) => {
    onPurchased()
  }

  return (
    <CheckoutSteps.Root
      productRef={productRef}
      returnUrl={returnUrl}
      autoSelectFirstPaid
      onPurchaseSuccess={handleSuccess}
    >
      <CheckoutSteps.StepHeading className="text-lg font-semibold" />
      <CheckoutSteps.StepMessage className="mb-4 text-sm text-muted-foreground" />

      <CheckoutSteps.IfStep step="plan">
        <CheckoutSteps.PlanGrid />
        <PlanSelector.Loading />
        <PlanSelector.Error />
        <CheckoutSteps.PlanContinueButton className={buttonClassName} />
      </CheckoutSteps.IfStep>

      <CheckoutSteps.IfStep step="amount">
        <CheckoutSteps.BackLink className={backLinkClassName} />
        <CheckoutSteps.AmountPicker />
        <CheckoutSteps.AmountContinueButton className={buttonClassName} />
      </CheckoutSteps.IfStep>

      <CheckoutSteps.IfStep step="payment">
        <CheckoutSteps.BackLink className={backLinkClassName} />
        <CheckoutSteps.Payment />
      </CheckoutSteps.IfStep>

      <CheckoutSteps.IfStep step="success">
        <CheckoutSteps.Success />
      </CheckoutSteps.IfStep>
    </CheckoutSteps.Root>
  )
}
