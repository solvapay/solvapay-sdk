'use client'

/**
 * Default-tree shim over the `AmountPicker` primitive.
 *
 * Renders the golden-path pills + custom input combo consumers expect in
 * drop-in usage. For full control (alternate layouts, custom confirm
 * affordance, Tailwind variants), compose
 * `@solvapay/react/primitives` directly.
 */

import React from 'react'
import {
  AmountPicker as Primitive,
  useAmountPicker,
  useAmountPickerCopy,
} from '../primitives/AmountPicker'

export interface AmountPickerProps {
  currency: string
  minAmount?: number
  maxAmount?: number
  showCreditEstimate?: boolean
  onChange?: (amount: number | null) => void
  className?: string
}

export const AmountPicker: React.FC<AmountPickerProps> = ({
  currency,
  minAmount,
  maxAmount,
  showCreditEstimate = true,
  onChange,
  className,
}) => {
  const rootClass = ['solvapay-amount-picker', className].filter(Boolean).join(' ')
  return (
    <Primitive.Root
      currency={currency}
      minAmount={minAmount}
      maxAmount={maxAmount}
      onChange={onChange}
      className={rootClass}
    >
      <DefaultTree showCreditEstimate={showCreditEstimate} />
    </Primitive.Root>
  )
}

const DefaultTree: React.FC<{ showCreditEstimate: boolean }> = ({ showCreditEstimate }) => {
  const ctx = useAmountPicker()
  const { selectAmountLabel, customAmountLabel, creditEstimate } = useAmountPickerCopy()

  return (
    <>
      <p className="solvapay-amount-picker-label">{selectAmountLabel}</p>
      <div className="solvapay-amount-picker-pills">
        {ctx.quickAmounts.map(amount => (
          <Primitive.Option
            key={amount}
            amount={amount}
            className="solvapay-amount-picker-pill"
          />
        ))}
      </div>
      <div className="solvapay-amount-picker-custom-wrapper">
        <p className="solvapay-amount-picker-custom-label">{customAmountLabel}</p>
        <div className="solvapay-amount-picker-custom-row">
          <span className="solvapay-amount-picker-currency-symbol">{ctx.currencySymbol}</span>
          <Primitive.Custom className="solvapay-amount-picker-custom-input" />
        </div>
      </div>
      {showCreditEstimate && ctx.estimatedCredits != null && (
        <p className="solvapay-amount-picker-credit-estimate">
          {creditEstimate(ctx.estimatedCredits)}
        </p>
      )}
      {ctx.error && (
        <p role="alert" className="solvapay-amount-picker-error">
          {ctx.error}
        </p>
      )}
    </>
  )
}
