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
 *  3. Success state — terminal receipt only (check glyph, amount,
 *     credits). No CTA below the receipt: by the time this step
 *     mounts, `notifySuccess({ kind: 'topup' })` has already posted
 *     a user-visible message to the conversation, so the agent
 *     continues the flow on its own — same pattern as checkout's
 *     `<SuccessStep>`.
 *
 * `useStripeProbe` starts at mount so Stripe.js can warm while the
 * customer picks an amount. The probe only gates the payment step —
 * a blocked host still sees the amount picker, then the hosted
 * customer-portal handoff.
 *
 * When called from the paywall's secondary "Top up" button, the shell
 * doesn't have an Account tab to route back to (the paywall is a
 * take-over); the shell passes `onBack={undefined}` and the view
 * skips the outer back-link.
 */

import React, { useRef, useState } from 'react'
import type { AutoRechargeInput } from '@solvapay/server'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useBalance } from '../../hooks/useBalance'
import { useMerchant } from '../../hooks/useMerchant'
import { useTopupAmountSelector } from '../../hooks/useTopupAmountSelector'
import { AmountPicker, useAmountPicker } from '../../primitives/AmountPicker'
import { BalanceBadge } from '../../primitives/BalanceBadge'
import { MandateText } from '../../primitives/MandateText'
import { TopupForm, useTopupForm } from '../../primitives/TopupForm'
import { formatPrice, getMinorUnitsPerMajor } from '../../utils/format'
import { formatCompactCredits } from '../format-compact-credits'
import { useDisplayMode } from '../hooks/useDisplayMode'
import { useMcpBridge } from '../bridge'
import { useHostLocale } from '../useHostLocale'
import { useStripeProbe, type StripeProbeState } from '../useStripeProbe'
import { chargeAmountMinor } from './chargeAmount'
import { AmountLadder, Eyebrow } from '../primitives'
import { BackLink } from './BackLink'
import {
  McpInlineAutoRecharge,
  type McpInlineAutoRechargeHandle,
} from './autoRecharge/McpInlineAutoRecharge'
import { McpHostedBody, McpHostedLayout, McpSummaryRail } from './McpHosted'
import { McpPaymentHeader } from './McpPaymentHeader'
import { MCP_PAYMENT_ELEMENT_OPTIONS } from './paymentElementOptions'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

const FALLBACK_TOPUP_CURRENCY = 'USD'

export interface McpTopupViewProps {
  /**
   * Stripe publishable key used by `useStripeProbe`. Pass `null` to skip
   * the probe: the amount step still renders, and the hosted portal
   * handoff is forced only at the payment step.
   */
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
  | { step: 'payment'; amountMinor: number; autoRecharge?: AutoRechargeInput }
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

  if (merchantLoading) {
    return (
      <section className={cx.card} aria-label="Loading top-up">
        <p>Loading top-up…</p>
      </section>
    )
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
      stripeProbe={probe}
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
  stripeProbe,
  cx,
}: {
  returnUrl: string
  defaultCurrency: string
  topupCurrencies: string[]
  onTopupSuccess?: (amountMinor: number) => void
  onBack?: () => void
  stripeProbe: StripeProbeState
  cx: Cx
}) {
  const [screen, setScreen] = useState<TopupScreen>({ step: 'amount' })
  const [selectedCurrency, setSelectedCurrency] = useState(defaultCurrency)
  const currency = selectedCurrency
  const showCurrencySwitch = topupCurrencies.length > 1
  const { adjustBalance, credits, creditsPerMinorUnit, displayCurrency, displayExchangeRate } =
    useBalance()
  const autoRechargeRef = useRef<McpInlineAutoRechargeHandle>(null)
  const locale = useHostLocale()
  const { notifyModelContext, notifySuccess } = useMcpBridge()
  const topupSelector = useTopupAmountSelector({ currency })
  const { displayMode } = useDisplayMode()
  const isFullscreen = displayMode === 'fullscreen'

  const handleCurrencyChange = (code: string) => {
    setSelectedCurrency(code.toUpperCase())
    setScreen({ step: 'amount' })
    topupSelector.reset()
  }

  if (screen.step === 'success') {
    const estimate = estimateTopupCredits(
      screen.amountMinor,
      currency,
      displayCurrency,
      creditsPerMinorUnit,
      displayExchangeRate,
    )
    return (
      <section className={cx.card} aria-label="Top-up success">
        <div className="solvapay-mcp-checkout-success-check" aria-hidden="true">
          ✓
        </div>
        <h2 className={cx.heading}>Credits added</h2>
        <dl className="solvapay-mcp-checkout-receipt" data-variant="payg">
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Amount</dt>
            <dd>{formatPrice(screen.amountMinor, currency, { locale, free: '' })}</dd>
          </div>
          {estimate.kind === 'available' ? (
            <div className="solvapay-mcp-checkout-receipt-row">
              <dt>Credits</dt>
              <dd>+{estimate.credits.toLocaleString(locale)}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    )
  }

  if (screen.step === 'payment') {
    if (stripeProbe === 'loading') {
      return (
        <section className={cx.card} aria-label="Loading top-up">
          <p>Loading top-up…</p>
        </section>
      )
    }
    if (stripeProbe === 'blocked') {
      return (
        <HostedTopupFallback cx={cx} onChangeAmount={() => setScreen({ step: 'amount' })} />
      )
    }

    const committedAmountMinor = screen.amountMinor
    // Auto-recharge is what makes the backend set `setup_future_usage`, so it
    // is also what the mandate has to disclose.
    const savesCard = screen.autoRecharge != null
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
        <TopupForm.Root
          amount={committedAmountMinor}
          currency={currency}
          autoRecharge={screen.autoRecharge}
          returnUrl={returnUrl}
          onSuccess={() => {
            if (creditsPerMinorUnit != null && creditsPerMinorUnit > 0) {
              adjustBalance(committedAmountMinor * creditsPerMinorUnit)
            }
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
          <McpHostedLayout>
            <McpSummaryRail>
              <section className={cx.stack}>
                <p className={cx.muted}>Total due today</p>
                <p className={cx.topupAmountHero}>
                  <TopupChargeAmount amountMinor={committedAmountMinor} currency={currency} />
                </p>
                {contextParts.length > 0 ? (
                  <p className={cx.topupBalanceContext}>{contextParts.join(' · ')}</p>
                ) : null}
                {isFullscreen ? (
                  <TopupForm.Summary.Rows className={cx.taxSummary} />
                ) : (
                  <TopupForm.Summary.TaxNote className={cx.muted} />
                )}
              </section>
            </McpSummaryRail>
            <McpHostedBody>
              <McpPaymentHeader
                backLabel="Change amount"
                onBack={() => setScreen({ step: 'amount' })}
              />
              <div className={cx.topupForm}>
                <TopupForm.Loading />
                <TopupForm.PaymentElement options={MCP_PAYMENT_ELEMENT_OPTIONS} />
                <TopupForm.BusinessDetails.Root className={cx.businessDetails}>
                  <TopupForm.BusinessDetails.Fields />
                </TopupForm.BusinessDetails.Root>
                <TopupForm.Error className={cx.error} />
                <TopupForm.SubmitButton className={cx.button}>
                  Top up{' '}
                  <TopupChargeAmount amountMinor={committedAmountMinor} currency={currency} />
                </TopupForm.SubmitButton>
                <MandateText
                  mode="topup"
                  amountMinor={committedAmountMinor}
                  currency={currency}
                  savesPaymentMethod={savesCard}
                />
              </div>
            </McpHostedBody>
          </McpHostedLayout>
        </TopupForm.Root>
      </section>
    )
  }

  const currencyDisplay = showCurrencySwitch ? 'code' : 'symbol'

  const amountForm = (
    <AmountPicker.Root
      currency={currency}
      emit="minor"
      selector={topupSelector}
      className={cx.amountPicker}
    >
      {isFullscreen ? null : (
        <AmountStepHeader
          cx={cx}
          currency={currency}
          topupCurrencies={topupCurrencies}
          showCurrencySwitch={showCurrencySwitch}
          onCurrencyChange={handleCurrencyChange}
        />
      )}
      <PresetAmountGrid currencyDisplay={currencyDisplay} locale={locale} />
      <CustomAmountRow
        rowClassName={cx.amountCustom}
        currencyDisplay={currencyDisplay}
      />
      <McpInlineAutoRecharge
        ref={autoRechargeRef}
        currency={currency}
        creditsPerMinorUnit={creditsPerMinorUnit}
        displayExchangeRate={displayExchangeRate}
      />
      <AmountDueSummary locale={locale} currency={currency} />
      <AmountPicker.Confirm
        className={cx.button}
        onConfirm={amountMinor => {
          const result = autoRechargeRef.current?.validate()
          if (result == null) {
            throw new Error('McpTopupView: auto-recharge form is not mounted')
          }
          if (!result.ok) return
          setScreen({
            step: 'payment',
            amountMinor,
            autoRecharge: result.payload,
          })
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
  )

  if (isFullscreen) {
    return (
      <section className={cx.card} aria-label="Add credits">
        <McpHostedLayout>
          <McpSummaryRail>
            <AmountStepHeader
              cx={cx}
              currency={currency}
              topupCurrencies={topupCurrencies}
              showCurrencySwitch={showCurrencySwitch}
              onCurrencyChange={handleCurrencyChange}
              rail
            />
          </McpSummaryRail>
          <McpHostedBody>
            {onBack ? <BackLink label="Back to my account" onClick={onBack} /> : null}
            {amountForm}
          </McpHostedBody>
        </McpHostedLayout>
      </section>
    )
  }

  return (
    <section className={cx.card} aria-label="Add credits">
      {onBack ? <BackLink label="Back to my account" onClick={onBack} /> : null}
      {amountForm}
    </section>
  )
}

function TopupChargeAmount({
  amountMinor,
  currency,
}: {
  amountMinor: number
  currency: string
}) {
  const locale = useHostLocale()
  const { taxBreakdown } = useTopupForm()
  const minor = chargeAmountMinor(taxBreakdown, amountMinor)
  return <>{formatPrice(minor, taxBreakdown?.currency ?? currency, { locale, free: '' })}</>
}

function AmountStepHeader({
  cx,
  currency,
  topupCurrencies,
  showCurrencySwitch,
  onCurrencyChange,
  rail,
}: {
  cx: Cx
  currency: string
  topupCurrencies: string[]
  showCurrencySwitch: boolean
  onCurrencyChange: (code: string) => void
  rail?: boolean
}) {
  const { credits } = useBalance()
  const locale = useHostLocale()
  const formattedBalance =
    credits != null ? new Intl.NumberFormat(locale).format(credits) : undefined
  return (
    <header className={rail ? cx.stack : undefined}>
      {rail ? (
        <>
          <Eyebrow variant="rail">Add credits</Eyebrow>
          {formattedBalance ? (
            <p className={cx.muted}>Balance {formattedBalance} credits</p>
          ) : null}
        </>
      ) : (
        <div className={cx.balanceRow}>
          <h2 className={cx.heading}>Add credits</h2>
          <BalanceBadge />
        </div>
      )}
      {showCurrencySwitch ? (
        <label className="solvapay-mcp-step-header">
          <span className={cx.muted}>Pay in</span>
          <select
            className="solvapay-mcp-currency-switch"
            value={currency}
            onChange={event => onCurrencyChange(event.target.value)}
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
    </header>
  )
}

function PresetAmountGrid({
  currencyDisplay,
  locale,
}: {
  currencyDisplay: 'symbol' | 'code'
  locale: string
}) {
  const { quickAmounts, currency, creditsPerMinorUnit, displayExchangeRate } =
    useAmountPicker()
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
              {estimate.kind === 'available'
                ? formatCompactCredits(estimate.credits, locale)
                : ''}
            </span>
          </AmountPicker.Option>
        )
      })}
    </div>
  )
}

function AmountDueSummary({ locale, currency }: { locale: string; currency: string }) {
  const { resolvedAmountMinor } = useAmountPicker()
  const displayAmount =
    resolvedAmountMinor != null
      ? formatPrice(resolvedAmountMinor, currency, { locale, free: '' })
      : formatPrice(0, currency, { locale, free: '' })
  return (
    <AmountLadder
      rows={[
        {
          label: 'Total due today',
          value: <span className="solvapay-mcp-topup-total">{displayAmount}</span>,
        },
      ]}
    />
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

function HostedTopupFallback({
  cx,
  onChangeAmount,
}: {
  cx: Cx
  onChangeAmount: () => void
}) {
  return (
    <section className={cx.card} aria-label="Add credits">
      <BackLink label="Change amount" onClick={onChangeAmount} />
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
