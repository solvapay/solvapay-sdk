'use client'

/**
 * `<McpTopupView>` — the "add credits" screen surfaced by the `topup`
 * MCP tool.
 *
 * Three-step flow with shared back-nav:
 *  1. `<AmountPicker emit="minor">` — quick-pick pills + custom input.
 *     Has a `← Back to my account` BackLink when `onBack` is wired.
 *  2. `TopupForm.Root` — mounts only once the amount is committed so
 *     we don't create a Stripe PaymentIntent per keystroke. Has a
 *     `← Change amount` BackLink + the outer `Back to my account`.
 *  3. Success state — "Credits added" + `[ Add more credits ]` +
 *     `Manage billing ↗`, same `Back to my account` back-link.
 *
 * Gated behind `useStripeProbe` with the same fallback logic as
 * `<McpCheckoutView>`: if the host sandbox's CSP refuses to load
 * `js.stripe.com` the embedded `PaymentElement` can't render, so we
 * drop back to the hosted customer portal.
 *
 * When called from the paywall's secondary "Top up" button, the shell
 * doesn't have an Account tab to route back to (the paywall is a
 * take-over); the shell passes `onBack={undefined}` and the view
 * skips the outer back-link.
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
import { formatPrice } from '../../utils/format'
import { useMcpBridge } from '../bridge'
import { useHostLocale } from '../useHostLocale'
import { useStripeProbe } from '../useStripeProbe'
import { BackLink } from './BackLink'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

const FALLBACK_TOPUP_CURRENCY = 'USD'

export interface McpTopupViewProps {
  publishableKey?: string | null
  returnUrl: string
  /**
   * Called when the Stripe confirm succeeds. Receives the topped-up amount
   * in minor units (respects zero-decimal currencies — yen not yen×100).
   */
  onTopupSuccess?: (amountMinor: number) => void
  /**
   * Called when the user picks "Back to my account" at any step.
   * Wired by the shell to switch tabs. `undefined` (the paywall
   * branch) hides the outer back-link.
   */
  onBack?: () => void
  classNames?: McpViewClassNames
}

export function McpTopupView({
  publishableKey = null,
  returnUrl,
  onTopupSuccess,
  onBack,
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

  if (probe === 'blocked')
    return <HostedTopupFallback cx={cx} onBack={onBack} />

  const currency = merchant?.defaultCurrency?.toUpperCase() ?? FALLBACK_TOPUP_CURRENCY

  return (
    <EmbeddedTopup
      returnUrl={returnUrl}
      currency={currency}
      onTopupSuccess={onTopupSuccess}
      onBack={onBack}
      cx={cx}
    />
  )
}

type Cx = ReturnType<typeof resolveMcpClassNames>

function EmbeddedTopup({
  returnUrl,
  currency,
  onTopupSuccess,
  onBack,
  cx,
}: {
  returnUrl: string
  currency: string
  onTopupSuccess?: (amountMinor: number) => void
  onBack?: () => void
  cx: Cx
}) {
  const [committedAmountMinor, setCommittedAmountMinor] = useState<number | null>(null)
  const [justPaidMinor, setJustPaidMinor] = useState<number | null>(null)
  const { adjustBalance, creditsPerMinorUnit } = useBalance()
  const locale = useHostLocale()
  const { notifyModelContext, notifySuccess } = useMcpBridge()

  if (justPaidMinor != null) {
    const displayAmount = formatPrice(justPaidMinor, currency, { locale, free: '' })
    return (
      <div className={cx.card}>
        {onBack ? <BackLink label="Back to my account" onClick={onBack} /> : null}
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
          className={cx.button}
          loadingClassName={cx.button}
          errorClassName={cx.button}
        >
          Manage billing
        </LaunchCustomerPortalButton>
      </div>
    )
  }

  if (committedAmountMinor != null && committedAmountMinor > 0) {
    const displayAmount = formatPrice(committedAmountMinor, currency, { locale, free: '' })
    return (
      <div className={cx.card}>
        {onBack ? <BackLink label="Back to my account" onClick={onBack} /> : null}
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
            adjustBalance(committedAmountMinor * (creditsPerMinorUnit ?? 100))
            setJustPaidMinor(committedAmountMinor)
            void notifyModelContext({
              text: `Topup of ${formatPrice(committedAmountMinor, currency, {
                locale,
                free: '',
              })} succeeded.`,
            })
            // Phase 5 — user-visible follow-up on a committed topup.
            void notifySuccess({
              kind: 'topup',
              amountMinor: committedAmountMinor,
              currency,
            })
            onTopupSuccess?.(committedAmountMinor)
            setCommittedAmountMinor(null)
          }}
        >
          <TopupForm.Loading />
          <TopupForm.PaymentElement />
          <TopupForm.Error className={cx.error} />
          <TopupForm.SubmitButton className={cx.button} />
        </TopupForm.Root>
        <BackLink
          label="Change amount"
          onClick={() => setCommittedAmountMinor(null)}
        />
      </div>
    )
  }

  return (
    <div className={cx.card}>
      {onBack ? <BackLink label="Back to my account" onClick={onBack} /> : null}
      <div className={cx.balanceRow}>
        <h2 className={cx.heading}>Add credits</h2>
        <BalanceBadge />
      </div>
      <AmountPicker.Root currency={currency} emit="minor" className={cx.amountPicker}>
        <QuickAmountOptions className={cx.amountOptions} optionClassName={cx.amountOption} />
        <AmountPicker.Custom className={cx.amountCustom} />
        <AmountPicker.Confirm
          className={cx.button}
          onConfirm={amountMinor => {
            setCommittedAmountMinor(amountMinor)
            // Phase 1 — committed topup amount. Give the model the
            // pending transaction context before the Stripe confirm
            // completes so it can reason about an in-progress purchase.
            void notifyModelContext({
              text: `User confirmed topup of ${formatPrice(amountMinor, currency, {
                locale,
                free: '',
              })}.`,
            })
          }}
        >
          Continue
        </AmountPicker.Confirm>
      </AmountPicker.Root>
    </div>
  )
}

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

function HostedTopupFallback({
  cx,
  onBack,
}: {
  cx: Cx
  onBack?: () => void
}) {
  return (
    <div className={cx.card}>
      {onBack ? <BackLink label="Back to my account" onClick={onBack} /> : null}
      <h2 className={cx.heading}>Add credits</h2>
      <p className={cx.muted}>
        {
          "This host doesn't allow embedded payments. Open the SolvaPay portal in a new tab to complete your top-up there."
        }
      </p>
      <LaunchCustomerPortalButton
        className={cx.button}
        loadingClassName={cx.button}
        errorClassName={cx.button}
      >
        Open SolvaPay portal
      </LaunchCustomerPortalButton>
    </div>
  )
}
