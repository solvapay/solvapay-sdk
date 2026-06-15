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
 *     single `← Change amount` BackLink at the top of the card; the
 *     outer "Back to my account" is intentionally dropped on this
 *     step so users don't have two competing back affordances on the
 *     same surface.
 *  3. Success state — "Credits added" + `[ Add more credits ]` +
 *     `Manage account ↗`, same `Back to my account` back-link.
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
import { MandateText } from '../../primitives/MandateText'
import { TopupForm } from '../../primitives/TopupForm'
import { formatPrice, getMinorUnitsPerMajor } from '../../utils/format'
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

  const defaultCurrency = merchant?.defaultCurrency?.toUpperCase() ?? FALLBACK_TOPUP_CURRENCY

  // Full set of pay currencies. The merchant payload already includes the
  // default in `supportedTopupCurrencies` (only when more than one is enabled);
  // single-currency merchants omit it, so we fall back to just the default.
  const fromMerchant = (merchant?.supportedTopupCurrencies ?? [])
    .map(code => code.toUpperCase())
    .filter(Boolean)
  const topupCurrencies = Array.from(
    new Set(fromMerchant.length > 0 ? fromMerchant : [defaultCurrency]),
  )

  return (
    <EmbeddedTopup
      returnUrl={returnUrl}
      defaultCurrency={defaultCurrency}
      topupCurrencies={topupCurrencies}
      onTopupSuccess={onTopupSuccess}
      onBack={onBack}
      cx={cx}
    />
  )
}

type Cx = ReturnType<typeof resolveMcpClassNames>

function EmbeddedTopup({
  returnUrl,
  defaultCurrency,
  topupCurrencies,
  onTopupSuccess,
  onBack,
  cx,
}: {
  returnUrl: string
  defaultCurrency: string
  topupCurrencies: string[]
  onTopupSuccess?: (amountMinor: number) => void
  onBack?: () => void
  cx: Cx
}) {
  const [committedAmountMinor, setCommittedAmountMinor] = useState<number | null>(null)
  const [justPaidMinor, setJustPaidMinor] = useState<number | null>(null)
  // Customer-chosen pay currency. Defaults to the merchant default; switching
  // it invalidates any committed amount (the Stripe PaymentIntent is
  // currency-scoped) so we drop back to amount selection.
  const [selectedCurrency, setSelectedCurrency] = useState(defaultCurrency)
  const currency = selectedCurrency
  const showCurrencySwitch = topupCurrencies.length > 1
  const { adjustBalance, credits, creditsPerMinorUnit, displayCurrency, displayExchangeRate } =
    useBalance()
  const locale = useHostLocale()
  const { notifyModelContext, notifySuccess } = useMcpBridge()

  const handleCurrencyChange = (code: string) => {
    setSelectedCurrency(code.toUpperCase())
    setCommittedAmountMinor(null)
    setJustPaidMinor(null)
  }

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
        />
      </div>
    )
  }

  if (committedAmountMinor != null && committedAmountMinor > 0) {
    const displayAmount = formatPrice(committedAmountMinor, currency, { locale, free: '' })
    // `displayExchangeRate` is the USD→display-currency rate. It only yields a
    // correct credit estimate when the chosen pay currency matches the display
    // currency; for any other pay currency we omit the estimate rather than
    // show a miscalculated figure. The backend reconciles the true credits on
    // payment success regardless.
    const rateAppliesToCurrency =
      displayCurrency != null && currency.toUpperCase() === displayCurrency.toUpperCase()
    const creditsAdded =
      rateAppliesToCurrency && creditsPerMinorUnit != null && creditsPerMinorUnit > 0
        ? Math.floor(
            (committedAmountMinor / (displayExchangeRate ?? 1)) * creditsPerMinorUnit,
          )
        : null
    const formattedBalance =
      credits != null ? new Intl.NumberFormat(locale).format(credits) : null
    const contextParts = [
      creditsAdded != null ? `Adds ${creditsAdded.toLocaleString(locale)} credits` : null,
      formattedBalance ? `Balance ${formattedBalance} credits` : null,
    ].filter(Boolean)

    return (
      <div className={cx.card}>
        <BackLink label="Change amount" onClick={() => setCommittedAmountMinor(null)} />
        <div className={cx.stack}>
          <p className={cx.muted}>Pay with card</p>
          <p className={cx.topupAmountHero}>{displayAmount}</p>
          {contextParts.length > 0 ? (
            <p className={cx.topupBalanceContext}>{contextParts.join(' · ')}</p>
          ) : null}
        </div>
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
          <MandateText
            mode="topup"
            amountMinor={committedAmountMinor}
            currency={currency}
          />
          <TopupForm.SubmitButton className={cx.button}>
            Top up {displayAmount}
          </TopupForm.SubmitButton>
        </TopupForm.Root>
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
      {showCurrencySwitch ? (
        <div className="solvapay-mcp-step-header">
          <span className={cx.muted}>Pay in</span>
          <select
            className="solvapay-mcp-currency-switch"
            value={currency}
            onChange={event => handleCurrencyChange(event.target.value)}
            aria-label="Topup currency"
          >
            {topupCurrencies.map(code => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <AmountPicker.Root currency={currency} emit="minor" className={cx.amountPicker}>
        <QuickAmountOptions
          className={cx.amountOptions}
          optionClassName={cx.amountOption}
          currencyDisplay={showCurrencySwitch ? 'code' : 'symbol'}
          locale={locale}
        />
        <CustomAmountRow
          rowClassName={cx.amountCustom}
          currencyDisplay={showCurrencySwitch ? 'code' : 'symbol'}
        />
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
  currencyDisplay,
  locale,
}: {
  className: string
  optionClassName: string
  currencyDisplay: 'symbol' | 'code'
  locale: string
}) {
  const { quickAmounts, currency } = useAmountPicker()
  return (
    <div className={className}>
      {quickAmounts.map(amount => {
        const label = formatPrice(amount * getMinorUnitsPerMajor(currency), currency, {
          locale,
          free: '',
          currencyDisplay,
        })
        return (
          <AmountPicker.Option key={amount} amount={amount} className={optionClassName}>
            {label}
          </AmountPicker.Option>
        )
      })}
    </div>
  )
}

// Bordered "$ 0.00" row matching the hosted topup page. The `cx.amountCustom`
// class now styles the wrapping `<div>` (was the `<input>` pre-refactor); the
// inner span carries the merchant currency symbol or code pulled from the picker
// context, and the input itself renders unstyled inside the row.
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
