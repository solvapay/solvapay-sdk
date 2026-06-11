'use client'

/**
 * Step 2 — PAYG amount picker. Only renders on the PAYG branch; the
 * recurring branch transitions directly from `plan` to `payment`.
 *
 * Activation has already happened at the plan step (the `activate_plan`
 * call behind the "Continue with Pay as you go" button), so clicking
 * `Continue` here just commits the topup amount and advances to the
 * payment step. No network call on this transition.
 */

import React, { memo, useState } from 'react'
import { AmountPicker, useAmountPicker } from '../../../../primitives/AmountPicker'
import { formatPrice, getMinorUnitsPerMajor } from '../../../../utils/format'
import { useHostLocale } from '../../../useHostLocale'
import { BackLink } from '../../BackLink'
import type { BootstrapPlanLike, Cx } from '../shared'

interface AmountStepProps {
  /**
   * Kept for caller-contract parity with the other steps. The topup amount is
   * merchant-wallet denominated, so plan fields (incl. `plan.currency`) are
   * intentionally not read here.
   */
  plan: BootstrapPlanLike
  topupCurrency?: string | null
  /**
   * Full set of pay currencies (incl. default). A switcher renders only when
   * this has more than one entry; single-currency merchants see no switcher.
   */
  topupCurrencies?: string[]
  /** Override the topup currency from the switcher. */
  onCurrencyChange?: (code: string) => void
  onBack: () => void
  onContinue: (amountMinor: number) => void
  cx: Cx
}

export const AmountStep = memo(function AmountStep({
  topupCurrency,
  topupCurrencies,
  onCurrencyChange,
  onBack,
  onContinue,
  cx,
}: AmountStepProps) {
  // Topup currency comes from the merchant/picker only. Plan currency is never
  // consulted — credit topups settle into the merchant-wide wallet.
  const currency = (topupCurrency ?? 'USD').toUpperCase()
  const locale = useHostLocale()

  const [stagedAmountMinor, setStagedAmountMinor] = useState<number | null>(null)

  const currencies = topupCurrencies ?? []
  const showCurrencySwitch = currencies.length > 1 && !!onCurrencyChange
  const currencyDisplay = showCurrencySwitch ? 'code' : 'symbol'

  return (
    <>
      <BackLink label="Back" onClick={onBack} />

      <div className="solvapay-mcp-step-header">
        <h2 className={cx.heading}>How many credits?</h2>
        {showCurrencySwitch && (
          <select
            className="solvapay-mcp-currency-switch"
            value={currency}
            onChange={event => onCurrencyChange?.(event.target.value)}
            aria-label="Topup currency"
          >
            {currencies.map(code => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className={cx.muted}>Top up to start using the tool.</p>

      <AmountPicker.Root
        currency={currency}
        emit="minor"
        className={cx.amountPicker}
        onChange={value => setStagedAmountMinor(value)}
      >
        <PresetAmountRow cx={cx} currencyDisplay={currencyDisplay} />
        <CustomAmountRow rowClassName={cx.amountCustom} currencyDisplay={currencyDisplay} />
        <AmountPicker.Confirm
          className={cx.button}
          onConfirm={amountMinor => onContinue(amountMinor)}
        >
          {stagedAmountMinor
            ? `Continue — ${formatPrice(stagedAmountMinor, currency, { locale, currencyDisplay })}`
            : 'Continue'}
        </AmountPicker.Confirm>
      </AmountPicker.Root>
    </>
  )
})

function PresetAmountRow({
  cx,
  currencyDisplay,
}: {
  cx: Cx
  currencyDisplay: 'symbol' | 'code'
}) {
  const { quickAmounts, currency } = useAmountPicker()
  const locale = useHostLocale()
  // Recommended preset: the second option (index 1) when available —
  // matches the pre-refactor wireframe's "middle chip" treatment.
  const popularIndex = Math.min(1, quickAmounts.length - 1)
  return (
    <div className={cx.amountOptions}>
      {quickAmounts.map((amount, i) => {
        const label = formatPrice(amount * getMinorUnitsPerMajor(currency), currency, {
          locale,
          free: '',
          currencyDisplay,
        })
        return (
          <AmountPicker.Option
            key={amount}
            amount={amount}
            className={cx.amountOption}
            data-popular={i === popularIndex ? '' : undefined}
            aria-label={`${label}${i === popularIndex ? ' (popular)' : ''}`}
          >
            {label}
          </AmountPicker.Option>
        )
      })}
    </div>
  )
}

// Bordered "$ 0.00" row mirroring the hosted topup page. `cx.amountCustom`
// styles the row wrapper now (post-pill-refactor); the inner span carries the
// merchant currency symbol or code, and the input renders unstyled inside.
function CustomAmountRow({
  rowClassName,
  currencyDisplay,
}: {
  rowClassName: string
  currencyDisplay: 'symbol' | 'code'
}) {
  const { currencySymbol, currency } = useAmountPicker()
  const prefix = currencyDisplay === 'code' ? currency.toUpperCase() : currencySymbol
  return (
    <div className={rowClassName}>
      <span className="solvapay-mcp-amount-currency-symbol">{prefix}</span>
      <AmountPicker.Custom className="solvapay-mcp-amount-custom-input" placeholder="0.00" />
    </div>
  )
}
