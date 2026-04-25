'use client'

/**
 * MandateText leaf primitive.
 *
 * Renders SCA-compliant authorization copy derived from the resolved plan,
 * product, and merchant identity. Variant is derived from the plan type +
 * billing model and can be forced via the `variant` or `mode` props (use
 * `mode="topup"` inside `<TopupForm>` where there is no plan). All strings
 * resolve through the localized copy bundle so integrators can override
 * text without forking the component.
 */

import React, { forwardRef, useContext, useMemo } from 'react'
import { Slot } from './slot'
import { usePlan } from '../hooks/usePlan'
import { useProduct } from '../hooks/useProduct'
import { useMerchant } from '../hooks/useMerchant'
import { useCopy, useLocale } from '../hooks/useCopy'
import { formatPrice } from '../utils/format'
import { deriveVariant, type CheckoutVariant } from '../utils/checkoutVariant'
import { usePlanSelection } from '../components/PlanSelectionContext'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import type { MandateContext } from '../i18n/types'

export type MandateTextProps = {
  planRef?: string
  productRef?: string
  variant?: CheckoutVariant
  mode?: 'topup'
  amountMinor?: number
  currency?: string
  asChild?: boolean
} & Omit<React.HTMLAttributes<HTMLParagraphElement>, 'children'> & {
    children?: React.ReactNode
  }

export const MandateText = forwardRef<HTMLParagraphElement, MandateTextProps>(
  function MandateText(
    {
      planRef,
      productRef,
      variant,
      mode,
      amountMinor,
      currency,
      asChild,
      children,
      ...rest
    },
    forwardedRef,
  ) {
    const solva = useContext(SolvaPayContext)
    if (!solva) throw new MissingProviderError('MandateText')

    const locale = useLocale()
    const copy = useCopy()
    const planSelection = usePlanSelection()
    const resolvedPlanRef = planRef ?? planSelection?.selectedPlanRef ?? undefined
    const resolvedProductRef = productRef ?? planSelection?.productRef
    const { plan } = usePlan({ planRef: resolvedPlanRef, productRef: resolvedProductRef })
    const { product } = useProduct(resolvedProductRef)
    const { merchant } = useMerchant()

    const resolvedVariant: CheckoutVariant = variant || deriveVariant(plan, mode)

    const effectiveAmount = amountMinor ?? plan?.price ?? 0
    const effectiveCurrency = currency ?? plan?.currency ?? merchant?.defaultCurrency ?? 'usd'
    const amountFormatted = formatPrice(effectiveAmount, effectiveCurrency, {
      locale,
      free: copy.interval.free,
    })

    const ctx: MandateContext = useMemo(
      () => ({
        merchant: {
          legalName: merchant?.legalName ?? merchant?.displayName ?? '',
          displayName: merchant?.displayName,
          supportEmail: merchant?.supportEmail,
          termsUrl: merchant?.termsUrl,
          privacyUrl: merchant?.privacyUrl,
        },
        plan: plan
          ? {
              name: plan.name,
              interval: plan.interval,
              intervalCount: 1,
              trialDays: plan.trialDays,
              measures: plan.measures,
              billingCycle: plan.billingCycle,
            }
          : undefined,
        product: product ? { name: product.name } : undefined,
        amountFormatted,
        trialDays: plan?.trialDays,
      }),
      [merchant, plan, product, amountFormatted],
    )

    const template = copy.mandate[resolvedVariant]
    const text = typeof template === 'function' ? template(ctx) : template
    if (!text) return null

    const Comp = asChild ? Slot : 'p'
    return (
      <Comp
        ref={forwardedRef}
        data-solvapay-mandate-text=""
        data-variant={resolvedVariant}
        {...rest}
      >
        {children ?? text}
      </Comp>
    )
  },
)
