'use client'

/**
 * `<McpTopupView>` — the "add credits" screen surfaced by the `open_topup`
 * MCP tool.
 *
 * Gated behind `useStripeProbe` with the same fallback logic as
 * `<McpCheckoutView>`: if the host sandbox's CSP refuses to load
 * `js.stripe.com` the embedded `PaymentElement` can't render, so we drop
 * back to the hosted customer portal.
 *
 * UX is a two-step confirm:
 *   1. `<AmountPicker emit="minor">` — quick-pick pills + custom input.
 *      `Confirm` runs `validate()` and emits the amount in minor units.
 *   2. `TopupForm.Root` — mounts only once the amount is committed so we
 *      don't create a Stripe PaymentIntent per keystroke.
 *
 * "Change amount" unmounts the form and returns to step 1 — safe because
 * the previous PI just expires unused (Stripe auto-cancels after 24h).
 */

import React, { useState } from 'react'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useBalance } from '../../hooks/useBalance'
import { useMerchant } from '../../hooks/useMerchant'
import {
  AmountPicker,
  useAmountPicker,
} from '../../primitives/AmountPicker'
import { BalanceBadge } from '../../primitives/BalanceBadge'
import { TopupForm } from '../../primitives/TopupForm'
import { getMinorUnitsPerMajor } from '../../utils/format'
import { useStripeProbe } from '../useStripeProbe'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

// Safety net only — `useMerchant().merchant.defaultCurrency` is the source of
// truth. Falls back to USD if the merchant fetch is pending or fails.
const FALLBACK_TOPUP_CURRENCY = 'USD'

function toMajorUnits(amountMinor: number, currency: string): number {
  return amountMinor / getMinorUnitsPerMajor(currency)
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export interface McpTopupViewProps {
  publishableKey?: string | null
  returnUrl: string
  /**
   * Called when the Stripe confirm succeeds. Receives the topped-up amount
   * in minor units (respects zero-decimal currencies — yen not yen×100).
   */
  onTopupSuccess?: (amountMinor: number) => void
  classNames?: McpViewClassNames
}

export function McpTopupView({
  publishableKey = null,
  returnUrl,
  onTopupSuccess,
  classNames,
}: McpTopupViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const probe = useStripeProbe(publishableKey)
  const { merchant, loading: merchantLoading } = useMerchant()

  if (probe === 'loading' || merchantLoading) {
    return (
      <div className={cx.card}>
        <p>Loading top-up…</p>
      </div>
    )
  }

  if (probe === 'blocked') return <HostedTopupFallback cx={cx} />

  const currency = merchant?.defaultCurrency?.toUpperCase() ?? FALLBACK_TOPUP_CURRENCY

  return (
    <EmbeddedTopup
      returnUrl={returnUrl}
      currency={currency}
      onTopupSuccess={onTopupSuccess}
      cx={cx}
    />
  )
}

type Cx = ReturnType<typeof resolveMcpClassNames>

function EmbeddedTopup({
  returnUrl,
  currency,
  onTopupSuccess,
  cx,
}: {
  returnUrl: string
  currency: string
  onTopupSuccess?: (amountMinor: number) => void
  cx: Cx
}) {
  const [committedAmountMinor, setCommittedAmountMinor] = useState<number | null>(null)
  const [justPaidMinor, setJustPaidMinor] = useState<number | null>(null)
  const { adjustBalance, creditsPerMinorUnit } = useBalance()

  if (justPaidMinor != null) {
    const displayAmount = formatCurrency(toMajorUnits(justPaidMinor, currency), currency)
    return (
      <div className={cx.card}>
        <div className={cx.balanceRow}>
          <h2 className={cx.heading}>Credits added</h2>
          <BalanceBadge />
        </div>
        <p className={cx.muted}>{displayAmount} landed in your balance.</p>
        <button
          type="button"
          className={cx.button}
          onClick={() => setJustPaidMinor(null)}
        >
          Add more credits
        </button>
        <LaunchCustomerPortalButton
          className={`${cx.button} ${cx.linkButton}`.trim()}
          loadingClassName={cx.button}
          errorClassName={cx.button}
        >
          Manage billing
        </LaunchCustomerPortalButton>
      </div>
    )
  }

  if (committedAmountMinor != null && committedAmountMinor > 0) {
    const displayAmount = formatCurrency(toMajorUnits(committedAmountMinor, currency), currency)
    return (
      <div className={cx.card}>
        <div className={cx.balanceRow}>
          <h2 className={cx.heading}>Pay with card</h2>
          <BalanceBadge />
        </div>
        <p className={cx.muted}>Adding {displayAmount} in credits.</p>
        <TopupForm.Root
          amount={committedAmountMinor}
          currency={currency}
          returnUrl={returnUrl}
          className={cx.topupForm}
          onSuccess={() => {
            // Optimistically bump the local balance so `<BalanceBadge>` in
            // the success panel reflects the top-up immediately — the
            // webhook-driven refetch will reconcile shortly after.
            adjustBalance(committedAmountMinor * (creditsPerMinorUnit ?? 100))
            setJustPaidMinor(committedAmountMinor)
            onTopupSuccess?.(committedAmountMinor)
            setCommittedAmountMinor(null)
          }}
        >
          <TopupForm.Loading />
          <TopupForm.PaymentElement />
          <TopupForm.Error className={cx.error} />
          <TopupForm.SubmitButton className={cx.button} />
        </TopupForm.Root>
        <button
          type="button"
          className={cx.linkButton}
          onClick={() => setCommittedAmountMinor(null)}
        >
          Change amount
        </button>
      </div>
    )
  }

  return (
    <div className={cx.card}>
      <div className={cx.balanceRow}>
        <h2 className={cx.heading}>Add credits</h2>
        <BalanceBadge />
      </div>
      <AmountPicker.Root currency={currency} emit="minor" className={cx.amountPicker}>
        <QuickAmountOptions className={cx.amountOptions} optionClassName={cx.amountOption} />
        <AmountPicker.Custom className={cx.amountCustom} />
        <AmountPicker.Confirm
          className={cx.button}
          onConfirm={amountMinor => setCommittedAmountMinor(amountMinor)}
        >
          Continue
        </AmountPicker.Confirm>
      </AmountPicker.Root>
    </div>
  )
}

/**
 * Renders the currency-aware quick-pick presets. Reads `quickAmounts` from
 * the picker context so presets stay in sync with the merchant currency.
 */
function QuickAmountOptions({
  className,
  optionClassName,
}: {
  className: string
  optionClassName: string
}) {
  const { quickAmounts } = useAmountPicker()
  return (
    <div className={className}>
      {quickAmounts.map(amount => (
        <AmountPicker.Option key={amount} amount={amount} className={optionClassName} />
      ))}
    </div>
  )
}

/**
 * Probe-blocked fallback. Stripe Elements can't mount inside this host
 * sandbox, so we route the customer to the hosted portal where they can
 * complete a top-up the old-fashioned way.
 */
function HostedTopupFallback({ cx }: { cx: Cx }) {
  return (
    <div className={cx.card}>
      <h2 className={cx.heading}>Add credits</h2>
      <p className={cx.muted}>
        {
          "This host doesn't allow embedded payments. Open the SolvaPay portal in a new tab to complete your top-up there."
        }
      </p>
      <LaunchCustomerPortalButton
        className={`${cx.button} ${cx.linkButton}`.trim()}
        loadingClassName={cx.button}
        errorClassName={cx.button}
      >
        Open SolvaPay portal
      </LaunchCustomerPortalButton>
    </div>
  )
}
