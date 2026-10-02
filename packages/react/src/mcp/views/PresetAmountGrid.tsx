'use client'

/**
 * Full-width quick-amount tiles shared by the `topup` view and the
 * checkout PAYG amount step. Reads the picker and balance from context
 * so both surfaces stay identical.
 */

import React from 'react'
import { useBalance } from '../../hooks/useBalance'
import { AmountPicker, useAmountPicker } from '../../primitives/AmountPicker'
import { formatPrice, getMinorUnitsPerMajor } from '../../utils/format'
import { formatCompactCredits } from '../format-compact-credits'
import { useHostLocale } from '../useHostLocale'

export type CreditEstimate = { kind: 'available'; credits: number } | { kind: 'unavailable' }

export function estimateTopupCredits(
  amountMinor: number,
  payCurrency: string,
  displayCurrency: string | null | undefined,
  creditsPerMinorUnit: number | null | undefined,
  displayExchangeRate: number | null | undefined,
): CreditEstimate {
  const rateAppliesToCurrency =
    displayCurrency != null && payCurrency.toUpperCase() === displayCurrency.toUpperCase()
  if (
    !rateAppliesToCurrency ||
    creditsPerMinorUnit == null ||
    creditsPerMinorUnit <= 0 ||
    displayExchangeRate == null ||
    displayExchangeRate <= 0
  ) {
    return { kind: 'unavailable' }
  }
  const credits = Math.floor((amountMinor / displayExchangeRate) * creditsPerMinorUnit)
  return { kind: 'available', credits }
}

export function PresetAmountGrid({
  currencyDisplay,
}: {
  currencyDisplay: 'symbol' | 'code'
}): React.ReactElement {
  const locale = useHostLocale()
  const { quickAmounts, currency, creditsPerMinorUnit, displayExchangeRate } = useAmountPicker()
  const { displayCurrency } = useBalance()
  return (
    <div className="solvapay-mcp-preset-grid" aria-label="Quick amounts">
      {quickAmounts.map(amount => {
        const minor = amount * getMinorUnitsPerMajor(currency)
        const label = formatPrice(minor, currency, {
          locale,
          free: '',
          currencyDisplay,
        })
        const estimate = estimateTopupCredits(
          minor,
          currency,
          displayCurrency,
          creditsPerMinorUnit,
          displayExchangeRate,
        )
        return (
          <AmountPicker.Option key={amount} amount={amount} className="solvapay-mcp-preset-tile">
            <span className="solvapay-mcp-preset-tile-amount">{label}</span>
            <span className="solvapay-mcp-preset-tile-credits">
              {estimate.kind === 'available' ? formatCompactCredits(estimate.credits, locale) : ''}
            </span>
          </AmountPicker.Option>
        )
      })}
    </div>
  )
}
