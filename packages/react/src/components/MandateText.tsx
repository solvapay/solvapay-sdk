'use client'
import React, { useMemo } from 'react'
import { usePlan } from '../hooks/usePlan'
import { useProduct } from '../hooks/useProduct'
import { useMerchant } from '../hooks/useMerchant'
import { useCopy, useLocale } from '../hooks/useCopy'
import { formatPrice } from '../utils/format'
import { deriveVariant, type CheckoutVariant } from '../utils/checkoutVariant'
import type { MandateContext } from '../i18n/types'

export type MandateTextProps = {
  planRef?: string
  productRef?: string
  /**
   * Force a specific variant. When omitted, derived from the resolved plan.
   * Use `mode="topup"` for `<TopupForm>` where there is no plan.
   */
  variant?: CheckoutVariant
  /** Shorthand for TopupForm: same as `variant="topup"`. */
  mode?: 'topup'
  /**
   * Amount override in minor units. Used by TopupForm since the amount isn't
   * carried on a plan. Defaults to `plan.price`.
   */
  amountMinor?: number
  currency?: string
  className?: string
}

/**
 * SCA-compliant mandate / authorization copy. Variant is derived from the
 * plan's type + billing model, or forced via props. Every string comes from
 * the localized copy bundle so non-English integrators can override it.
 */
export const MandateText: React.FC<MandateTextProps> = ({
  planRef,
  productRef,
  variant,
  mode,
  amountMinor,
  currency,
  className,
}) => {
  const locale = useLocale()
  const copy = useCopy()
  const { plan } = usePlan({ planRef, productRef })
  const { product } = useProduct(productRef)
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
  const text =
    typeof template === 'function' ? template(ctx) : template

  if (!text) return null

  return (
    <p
      className={className}
      data-solvapay-mandate-text=""
      style={{
        fontSize: 12,
        lineHeight: 1.5,
        color: 'rgba(0,0,0,0.6)',
        margin: 0,
      }}
    >
      {text}
    </p>
  )
}
