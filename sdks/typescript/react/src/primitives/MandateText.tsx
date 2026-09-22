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
 *
 * The copy templates embed legal URLs verbatim (merchant terms/privacy
 * when set, plus SolvaPay's own). `MandateText` post-processes the
 * rendered string and swaps those URLs for `<a target="_blank">` whose
 * visible label comes from `copy.legal.{termsOfService, privacyPolicy}`.
 * Keeps the i18n template signature untouched while lifting the legal
 * commitment to the point of charge.
 *
 * `savesPaymentMethod` marks a confirm that also stores the card for
 * later off-session charges (auto-recharge). The MCP payment surfaces
 * turn Stripe's own `terms` line off, so this component is the only
 * place that discloses the storage — the topup template appends a
 * saved-card sentence when the flag is set.
 *
 * SolvaPay's Terms of Service and Privacy Policy are always named and
 * linked. The merchant's own pair is added only when the merchant
 * record publishes `termsUrl` / `privacyUrl` — they are never used as
 * a substitute for SolvaPay's.
 */

import React, { forwardRef, useContext, useMemo } from 'react'
import { Slot } from './slot'
import { usePlan } from '../hooks/usePlan'
import { useProduct } from '../hooks/useProduct'
import { useMerchant } from '../hooks/useMerchant'
import { useCopy, useLocale } from '../hooks/useCopy'
import { useExternalLinkClick } from '../hooks/useExternalLink'
import { formatPrice } from '../utils/format'
import { deriveVariant, type CheckoutVariant } from '../utils/checkoutVariant'
import { usePlanSelection } from '../components/PlanSelectionContext'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'
import { resolveMandateLegalDocs } from '@solvapay/core'
import { SOLVAPAY_PRIVACY_URL, SOLVAPAY_TERMS_URL } from '../constants/legal'
import type { MandateContext, SolvaPayCopy } from '../i18n/types'

export type MandateTextProps = {
  planRef?: string
  productRef?: string
  variant?: CheckoutVariant
  mode?: 'topup'
  amountMinor?: number
  currency?: string
  /**
   * Set when the confirm also stores the card for later off-session
   * charges (auto-recharge), so the mandate discloses the storage.
   */
  savesPaymentMethod?: boolean
  asChild?: boolean
} & Omit<React.HTMLAttributes<HTMLParagraphElement>, 'children'> & {
    children?: React.ReactNode
  }

export const MandateText = forwardRef<HTMLParagraphElement, MandateTextProps>(function MandateText(
  {
    planRef,
    productRef,
    variant,
    mode,
    amountMinor,
    currency,
    savesPaymentMethod,
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
  const handleExternalClick = useExternalLinkClick()
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
      solvapay: {
        termsUrl: SOLVAPAY_TERMS_URL(),
        privacyUrl: SOLVAPAY_PRIVACY_URL(),
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
      savesPaymentMethod,
    }),
    [merchant, plan, product, amountFormatted, savesPaymentMethod],
  )

  const template = copy.mandate[resolvedVariant]
  const text = typeof template === 'function' ? template(ctx) : template
  if (!text) return null

  const Comp = asChild ? Slot : 'p'
  return (
    <Comp ref={forwardedRef} data-solvapay-mandate-text="" data-variant={resolvedVariant} {...rest}>
      {children ?? linkifyMandateText(text, ctx, copy, handleExternalClick)}
    </Comp>
  )
})

/**
 * Replace merchant and SolvaPay legal URLs in the rendered mandate text
 * with `<a>` elements labelled from `copy.legal.{termsOfService,
 * privacyPolicy}`. Core chooses the links and drops duplicate URLs.
 * Unrecognised URLs stay as plain text.
 */
function linkifyMandateText(
  text: string,
  ctx: MandateContext,
  copy: SolvaPayCopy,
  onLinkClick: (event: React.MouseEvent<HTMLAnchorElement>) => void,
): React.ReactNode[] {
  const docs = resolveMandateLegalDocs({
    merchantTermsUrl: ctx.merchant.termsUrl ?? null,
    merchantPrivacyUrl: ctx.merchant.privacyUrl ?? null,
    merchantDisplayName: ctx.merchant.displayName ?? null,
    merchantLegalName: ctx.merchant.legalName ?? null,
  })
  const entries = docs.links.map(link => ({
    url: link.url,
    label: link.kind === 'terms' ? copy.legal.termsOfService : copy.legal.privacyPolicy,
  }))

  if (entries.length === 0) return [text]

  const pattern = new RegExp(`(${entries.map(e => escapeRegExp(e.url)).join('|')})`, 'g')
  return text.split(pattern).map((part, i) => {
    const match = entries.find(e => e.url === part)
    if (!match) return part
    return (
      <a
        key={i}
        href={match.url}
        target="_blank"
        rel="noopener noreferrer"
        data-solvapay-mandate-link=""
        onClick={onLinkClick}
      >
        {match.label || match.url}
      </a>
    )
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
