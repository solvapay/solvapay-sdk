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
  plan: BootstrapPlanLike
  onBack: () => void
  onContinue: (amountMinor: number) => void
  cx: Cx
}

export const AmountStep = memo(function AmountStep({
  plan,
  onBack,
  onContinue,
  cx,
}: AmountStepProps) {
  const currency = (plan.currency ?? 'USD').toUpperCase()
  const locale = useHostLocale()

  const [stagedAmountMinor, setStagedAmountMinor] = useState<number | null>(null)

  return (
    <>
      <BackLink label="Back" onClick={onBack} />

      <h2 className={cx.heading}>How many credits?</h2>
      <p className={cx.muted}>Top up to start using the tool.</p>

      <AmountPicker.Root
        currency={currency}
        emit="minor"
        className={cx.amountPicker}
        onChange={value => setStagedAmountMinor(value)}
      >
        <PresetAmountRow cx={cx} />
        <AmountPicker.Custom className={cx.amountCustom} placeholder="or custom amount" />
        <AmountPicker.Confirm
          className={cx.button}
          onConfirm={amountMinor => onContinue(amountMinor)}
        >
          {stagedAmountMinor
            ? `Continue — ${formatPrice(stagedAmountMinor, currency, { locale })}`
            : 'Continue'}
        </AmountPicker.Confirm>
      </AmountPicker.Root>
    </>
  )
})

function PresetAmountRow({ cx }: { cx: Cx }) {
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
        })
        return (
          <AmountPicker.Option
            key={amount}
            amount={amount}
            className={cx.amountOption}
            data-popular={i === popularIndex ? '' : undefined}
            aria-label={`${label}${i === popularIndex ? ' (popular)' : ''}`}
          />
        )
      })}
    </div>
  )
}
