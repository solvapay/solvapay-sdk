'use client'

/**
 * BalanceBadge leaf primitive.
 *
 * Renders the customer's credit balance with an optional currency-equivalent
 * suffix. Emits `data-state=loading|zero|low|ok` plus a `data-credits`
 * attribute for CSS targeting. Low-balance threshold is configurable via the
 * `lowThreshold` prop (defaults to 10).
 */

import React, { forwardRef, useContext } from 'react'
import { Slot } from './slot'
import { useBalance } from '../hooks/useBalance'
import { useCopy, useLocale } from '../hooks/useCopy'
import { interpolate } from '../i18n/interpolate'
import { SolvaPayContext } from '../SolvaPayProvider'
import { MissingProviderError } from '../utils/errors'

type BalanceState = 'loading' | 'zero' | 'low' | 'ok'

type BalanceBadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  asChild?: boolean
  /** Hide the trailing " credits" label + currency equivalent. */
  numberOnly?: boolean
  /** Balance threshold (inclusive) treated as `data-state="low"`. Defaults to 10. */
  lowThreshold?: number
}

export const BalanceBadge = forwardRef<HTMLSpanElement, BalanceBadgeProps>(function BalanceBadge(
  { asChild, numberOnly, lowThreshold = 10, children, ...rest },
  forwardedRef,
) {
  const solva = useContext(SolvaPayContext)
  if (!solva) throw new MissingProviderError('BalanceBadge')

  const { credits, displayCurrency, creditsPerMinorUnit, displayExchangeRate, loading } =
    useBalance()
  const copy = useCopy()
  const locale = useLocale()

  const state: BalanceState = loading
    ? 'loading'
    : credits == null || credits === 0
      ? 'zero'
      : credits <= lowThreshold
        ? 'low'
        : 'ok'

  const commonProps: Record<string, unknown> = {
    'data-solvapay-balance-badge': '',
    'data-state': state,
    'data-credits': credits == null ? undefined : String(credits),
    'aria-busy': loading,
    ...rest,
  }

  if (state === 'loading') {
    if (asChild) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...commonProps}>
          {children ?? <></>}
        </Slot>
      )
    }
    return <span ref={forwardedRef} {...(commonProps as React.HTMLAttributes<HTMLSpanElement>)} />
  }

  if (credits == null) return null

  const formattedCredits = new Intl.NumberFormat(locale).format(credits)

  let currencyEquivalent = ''
  if (!numberOnly && displayCurrency && creditsPerMinorUnit) {
    const usdCents = credits / creditsPerMinorUnit
    const displayMajorUnits = (usdCents * (displayExchangeRate ?? 1)) / 100
    const formatted = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: displayCurrency,
      minimumFractionDigits: 2,
    }).format(displayMajorUnits)
    currencyEquivalent = interpolate(copy.balance.currencyEquivalent, { amount: formatted })
  }

  const content = children ?? (
    <>
      {formattedCredits}
      {!numberOnly && copy.balance.credits}
      {!numberOnly && currencyEquivalent}
    </>
  )

  if (asChild) {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Slot ref={forwardedRef as any} {...commonProps}>
        {content}
      </Slot>
    )
  }
  return (
    <span ref={forwardedRef} {...(commonProps as React.HTMLAttributes<HTMLSpanElement>)}>
      {content}
    </span>
  )
})
