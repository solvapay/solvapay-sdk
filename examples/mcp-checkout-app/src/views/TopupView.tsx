/**
 * TopupView — the "add credits" screen surfaced by the `open_topup` MCP
 * tool.
 *
 * Gated behind `useStripeProbe` with the same fallback logic as the
 * checkout view: if the host sandbox's CSP refuses to load `js.stripe.com`
 * the embedded `PaymentElement` can't render, so we drop back to the
 * hosted customer portal.
 *
 * UX is a two-step confirm:
 *   1. `AmountPicker` — quick-pick pills + custom input. `Confirm` runs
 *      `validate()` on the selector.
 *   2. `TopupForm.Root` — mounts only once the amount is committed so we
 *      don't create a Stripe PaymentIntent per keystroke.
 *
 * "Change amount" unmounts the form and returns to step 1 — safe because
 * the previous PI just expires unused (Stripe auto-cancels after 24h).
 */

import React, { useState } from 'react'
import {
  AmountPicker,
  BalanceBadge,
  TopupForm,
  useAmountPicker,
} from '@solvapay/react/primitives'
import { LaunchCustomerPortalButton, useBalance, useMerchant } from '@solvapay/react'
import { useStripeProbe } from './useStripeProbe'

// Safety net only — `useMerchant().merchant.defaultCurrency` is the source of
// truth. Falls back to USD if the merchant fetch is pending or fails.
const FALLBACK_TOPUP_CURRENCY = 'USD'

type TopupViewProps = {
  publishableKey: string | null
  returnUrl: string
}

export function TopupView({ publishableKey, returnUrl }: TopupViewProps) {
  const probe = useStripeProbe(publishableKey)
  const { merchant, loading: merchantLoading } = useMerchant()

  if (probe === 'loading' || merchantLoading) {
    return (
      <div className="checkout-card">
        <p>Loading top-up…</p>
      </div>
    )
  }

  if (probe === 'blocked') return <HostedTopupFallback />

  const currency = merchant?.defaultCurrency?.toUpperCase() ?? FALLBACK_TOPUP_CURRENCY

  return <EmbeddedTopup returnUrl={returnUrl} currency={currency} />
}

function EmbeddedTopup({ returnUrl, currency }: { returnUrl: string; currency: string }) {
  // Minor units (e.g. cents, öre). `AmountPicker` works in major units;
  // `TopupForm.Root` and `useTopup` expect minor units, so `onConfirm`
  // converts at the boundary — matches the pattern used across the other
  // examples (shadcn, tailwind, demo).
  const [committedAmountMinor, setCommittedAmountMinor] = useState<number | null>(null)
  const [justPaidMinor, setJustPaidMinor] = useState<number | null>(null)
  const { adjustBalance, creditsPerMinorUnit } = useBalance()

  if (justPaidMinor != null) {
    const displayAmount = formatCurrency(justPaidMinor / 100, currency)
    return (
      <div className="checkout-card">
        <div className="account-balance-row">
          <h2>Credits added</h2>
          <BalanceBadge />
        </div>
        <p className="checkout-muted">{displayAmount} landed in your balance.</p>
        <button
          type="button"
          className="hosted-button"
          onClick={() => setJustPaidMinor(null)}
        >
          Add more credits
        </button>
        <LaunchCustomerPortalButton
          className="hosted-button hosted-button-link"
          loadingClassName="hosted-button"
          errorClassName="hosted-button"
        >
          Manage billing
        </LaunchCustomerPortalButton>
      </div>
    )
  }

  if (committedAmountMinor != null && committedAmountMinor > 0) {
    const displayAmount = formatCurrency(committedAmountMinor / 100, currency)
    return (
      <div className="checkout-card">
        <div className="account-balance-row">
          <h2>Pay with card</h2>
          <BalanceBadge />
        </div>
        <p className="checkout-muted">Adding {displayAmount} in credits.</p>
        <TopupForm.Root
          amount={committedAmountMinor}
          currency={currency}
          returnUrl={returnUrl}
          className="topup-form"
          onSuccess={() => {
            // Optimistically bump the local balance so `<BalanceBadge>` in the
            // success panel reflects the top-up immediately — the webhook-driven
            // refetch will reconcile it shortly after. Matches the pattern in
            // examples/checkout-demo/app/topup/page.tsx.
            adjustBalance(committedAmountMinor * (creditsPerMinorUnit ?? 100))
            setJustPaidMinor(committedAmountMinor)
            setCommittedAmountMinor(null)
          }}
        >
          <TopupForm.Loading />
          <TopupForm.PaymentElement />
          <TopupForm.Error className="checkout-error" />
          <TopupForm.SubmitButton className="hosted-button" />
        </TopupForm.Root>
        <button
          type="button"
          className="checkout-link-button"
          onClick={() => setCommittedAmountMinor(null)}
        >
          Change amount
        </button>
      </div>
    )
  }

  return (
    <div className="checkout-card">
      <div className="account-balance-row">
        <h2>Add credits</h2>
        <BalanceBadge />
      </div>
      <AmountPicker.Root currency={currency} className="topup-amount-picker">
        <QuickAmountOptions />
        <AmountPicker.Custom className="topup-amount-custom" />
        <AmountPicker.Confirm
          className="hosted-button"
          onConfirm={amount => setCommittedAmountMinor(Math.round(amount * 100))}
        >
          Continue
        </AmountPicker.Confirm>
      </AmountPicker.Root>
    </div>
  )
}

/**
 * Renders the currency-aware quick-pick presets. Reading `quickAmounts` from
 * the picker context keeps the presets in sync with the merchant's default
 * currency — USD shows [10, 50, 100, 500]; SEK shows [100, 500, 1000, 5000];
 * JPY shows [1000, 5000, 10000, 50000]; etc.
 */
function QuickAmountOptions() {
  const { quickAmounts } = useAmountPicker()
  return (
    <div className="topup-amount-options">
      {quickAmounts.map(amount => (
        <AmountPicker.Option key={amount} amount={amount} className="topup-amount-option" />
      ))}
    </div>
  )
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/**
 * Probe-blocked fallback. Stripe Elements can't mount inside this host
 * sandbox, so we route the customer to the hosted portal where they can
 * complete a top-up the old-fashioned way.
 */
function HostedTopupFallback() {
  return (
    <div className="checkout-card">
      <h2>Add credits</h2>
      <p className="checkout-muted">
        This host doesn't allow embedded payments. Open the SolvaPay portal in a new tab to
        complete your top-up there.
      </p>
      <LaunchCustomerPortalButton
        className="hosted-button hosted-button-link"
        loadingClassName="hosted-button"
        errorClassName="hosted-button"
      >
        Open SolvaPay portal
      </LaunchCustomerPortalButton>
    </div>
  )
}
