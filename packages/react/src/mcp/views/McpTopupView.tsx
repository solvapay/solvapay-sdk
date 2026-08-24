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
import { useTopupAmountSelector } from '../../hooks/useTopupAmountSelector'
import { AmountPicker, useAmountPicker } from '../../primitives/AmountPicker'
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
  /** Public SDK contract — null means "no key supplied". Normalized internally. */
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

type TopupScreen =
  | { step: 'amount' }
  | { step: 'payment'; amountMinor: number }
  | { step: 'success'; amountMinor: number }

type CreditEstimate = { kind: 'available'; credits: number } | { kind: 'unavailable' }

function resolveDefaultCurrency(merchant: { defaultCurrency?: string } | undefined): string {
  if (merchant?.defaultCurrency) {
    return merchant.defaultCurrency.toUpperCase()
  }
  return FALLBACK_TOPUP_CURRENCY
}

function estimateTopupCredits(
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
      <section className={cx.card} aria-label="Loading top-up">
        <p>Loading top-up…</p>
      </section>
    )
  }

  if (probe === 'blocked') {
    return <HostedTopupFallback cx={cx} onBack={onBack} />
  }

  const defaultCurrency = resolveDefaultCurrency(merchant ?? undefined)

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
  const [screen, setScreen] = useState<TopupScreen>({ step: 'amount' })
  const [selectedCurrency, setSelectedCurrency] = useState(defaultCurrency)
  const currency = selectedCurrency
  const showCurrencySwitch = topupCurrencies.length > 1
  const { adjustBalance, credits, creditsPerMinorUnit, displayCurrency, displayExchangeRate } =
    useBalance()
  const locale = useHostLocale()
  const { notifyModelContext, notifySuccess } = useMcpBridge()
  const topupSelector = useTopupAmountSelector({ currency })

  const handleCurrencyChange = (code: string) => {
    setSelectedCurrency(code.toUpperCase())
    setScreen({ step: 'amount' })
    topupSelector.reset()
  }

  if (screen.step === 'success') {
    const displayAmount = formatPrice(screen.amountMinor, currency, { locale, free: '' })
    return (
      <section className={cx.card} aria-label="Top-up success">
        {onBack ? <BackLink label="Back to my account" onClick={onBack} /> : null}
        <header className={cx.balanceRow}>
          <h2 className={cx.heading}>Credits added</h2>
          <BalanceBadge />
        </header>
        <p className={cx.muted}>{displayAmount} landed in your balance.</p>
        <button type="button" className={cx.button} onClick={() => setScreen({ step: 'amount' })}>
          Add more credits
        </button>
        <LaunchCustomerPortalButton
          className={cx.button}
          loadingClassName={cx.button}
          errorClassName={cx.button}
        />
      </section>
    )
  }

  if (screen.step === 'payment') {
    const committedAmountMinor = screen.amountMinor
    const displayAmount = formatPrice(committedAmountMinor, currency, { locale, free: '' })
    const creditEstimate = estimateTopupCredits(
      committedAmountMinor,
      currency,
      displayCurrency,
      creditsPerMinorUnit,
      displayExchangeRate,
    )
    const formattedBalance =
      credits != null ? new Intl.NumberFormat(locale).format(credits) : undefined
    const contextParts = [
      creditEstimate.kind === 'available'
        ? `Adds ${creditEstimate.credits.toLocaleString(locale)} credits`
        : undefined,
      formattedBalance ? `Balance ${formattedBalance} credits` : undefined,
    ].filter((part): part is string => part != null)

    return (
      <section className={cx.card} aria-label="Top-up payment">
        <BackLink label="Change amount" onClick={() => setScreen({ step: 'amount' })} />
        <section className={cx.stack}>
          <p className={cx.muted}>Pay with card</p>
          <p className={cx.topupAmountHero}>{displayAmount}</p>
          {contextParts.length > 0 ? (
            <p className={cx.topupBalanceContext}>{contextParts.join(' · ')}</p>
          ) : null}
        </section>
        <TopupForm.Root
          amount={committedAmountMinor}
          currency={currency}
          returnUrl={returnUrl}
          className={cx.topupForm}
          onSuccess={() => {
            adjustBalance(committedAmountMinor * (creditsPerMinorUnit ?? 100))
            setScreen({ step: 'success', amountMinor: committedAmountMinor })
            void notifyModelContext({
              text: `Topup of ${formatPrice(committedAmountMinor, currency, {
                locale,
                free: '',
              })} succeeded.`,
            })
            void notifySuccess({
              kind: 'topup',
              amountMinor: committedAmountMinor,
              currency,
            })
            onTopupSuccess?.(committedAmountMinor)
          }}
        >
          <TopupForm.Loading />
          <TopupForm.BusinessDetails.Root className={cx.businessDetails}>
            <label className={cx.businessToggle}>
              <TopupForm.BusinessDetails.Toggle />
              I&apos;m purchasing as a business
            </label>
            <TopupForm.BusinessDetails.BusinessName
              className={cx.businessField}
              placeholder="Business name"
            />
            <TopupForm.BusinessDetails.Country className={cx.businessField} />
            <TopupForm.BusinessDetails.TaxId
              className={cx.businessField}
              placeholder="Tax / VAT ID"
            />
          </TopupForm.BusinessDetails.Root>
          <TopupForm.Summary.Root className={cx.taxSummary}>
            <TopupForm.Summary.Subtotal />
            <TopupForm.Summary.Tax />
            <TopupForm.Summary.Total />
          </TopupForm.Summary.Root>
          <TopupForm.PaymentElement />
          <TopupForm.Error className={cx.error} />
          <MandateText mode="topup" amountMinor={committedAmountMinor} currency={currency} />
          <TopupForm.SubmitButton className={cx.button}>
            Top up {displayAmount}
          </TopupForm.SubmitButton>
        </TopupForm.Root>
      </section>
    )
  }

  return (
    <section className={cx.card} aria-label="Add credits">
      {onBack ? <BackLink label="Back to my account" onClick={onBack} /> : null}
      <header className={cx.balanceRow}>
        <h2 className={cx.heading}>Add credits</h2>
        <BalanceBadge />
      </header>
      {showCurrencySwitch ? (
        <label className="solvapay-mcp-step-header">
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
        </label>
      ) : null}
      <AmountPicker.Root
        currency={currency}
        emit="minor"
        selector={topupSelector}
        className={cx.amountPicker}
      >
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
            setScreen({ step: 'payment', amountMinor })
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
    </section>
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
    <fieldset className={className} aria-label="Quick amounts">
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
    </fieldset>
  )
}

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
    <label className={rowClassName}>
      <span className="solvapay-mcp-amount-currency-symbol">{prefix}</span>
      <AmountPicker.Custom className="solvapay-mcp-amount-custom-input" placeholder="0.00" />
    </label>
  )
}

function HostedTopupFallback({ cx, onBack }: { cx: Cx; onBack?: () => void }) {
  return (
    <section className={cx.card} aria-label="Add credits">
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
    </section>
  )
}
