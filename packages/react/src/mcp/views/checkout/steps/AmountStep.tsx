'use client'

/**
 * Step 2 — PAYG amount picker. Only renders on the PAYG branch; the
 * recurring branch transitions directly from `plan` to `payment`.
 * Clicking `Continue` fires `activate_plan` via the parent's
 * `onContinue(amountMinor)` callback, then advances to the payment
 * step once the activation call resolves.
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
  onContinue: (amountMinor: number) => Promise<void>
  isActivating: boolean
  activationError: string | null
  cx: Cx
}

export const AmountStep = memo(function AmountStep({
  plan,
  onBack,
  onContinue,
  isActivating,
  activationError,
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
          onConfirm={amountMinor => {
            void onContinue(amountMinor)
          }}
        >
          {isActivating
            ? 'Activating…'
            : stagedAmountMinor
              ? `Continue — ${formatPrice(stagedAmountMinor, currency, { locale })}`
              : 'Continue'}
        </AmountPicker.Confirm>
      </AmountPicker.Root>

      {activationError ? (
        <p className={cx.error} role="alert">
          {activationError}
        </p>
      ) : null}
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
