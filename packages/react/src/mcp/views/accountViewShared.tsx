'use client'

import React from 'react'
import { creditsToDisplayMinorUnits, minorUnitsPerMajor } from '@solvapay/core'
import { useBalance } from '../../hooks/useBalance'
import { interpolate } from '../../i18n/interpolate'
import type { AccountState } from '../account-state'
import { Eyebrow, StatusDot, StatusPill, statusPillTone } from '../primitives'

export function PlanIdentityHeader({
  name,
  description,
  planLine,
  failing,
  failingLabel,
  status,
  statusLabel,
  pillState,
  changePlanLabel,
  showChangePlan,
  onChangePlan,
}: {
  name?: string | null
  description?: string | null
  planLine: string | null
  failing?: boolean
  failingLabel?: string
  /** Overrides the Active / failing defaults. A/H use `idle`, F/I use `pill`. */
  status?: 'active' | 'idle' | 'pill'
  statusLabel?: string
  /** Accent source for the pill. D / F / I. */
  pillState?: AccountState
  changePlanLabel: string
  showChangePlan: boolean
  onChangePlan?: (planRef?: string) => void
}): React.ReactElement {
  const kind = failing ? 'pill' : (status ?? 'active')
  const pillLabel = failing ? failingLabel : statusLabel
  return (
    <div className="solvapay-mcp-credit-plan-header">
      <div className="solvapay-mcp-credit-plan-identity">
        {name ? (
          <div className="solvapay-mcp-plan-row-name">
            <span>{name}</span>
            {kind === 'pill' && pillLabel ? (
              <StatusPill tone={statusPillTone(pillState ?? (failing ? 'D' : 'F'))}>
                {pillLabel}
              </StatusPill>
            ) : (
              <StatusDot
                label={statusLabel ?? (kind === 'idle' ? 'No plan' : 'Active')}
                empty={kind === 'idle'}
              />
            )}
          </div>
        ) : null}
        {description ? <p className="solvapay-mcp-muted">{description}</p> : null}
        {planLine ? <p className="solvapay-mcp-muted">{planLine}</p> : null}
      </div>
      {showChangePlan && onChangePlan ? (
        <button type="button" className="solvapay-mcp-link-button" onClick={() => onChangePlan()}>
          {changePlanLabel}
        </button>
      ) : null}
    </div>
  )
}

export function BalanceStrip({
  merchantName,
  locale,
  worksAcross,
  creditBalanceLabel,
  failingCaption,
}: {
  merchantName?: string
  locale: string
  worksAcross: string
  creditBalanceLabel: string
  failingCaption?: string | null
}): React.ReactElement {
  const { credits, displayCurrency, creditsPerMinorUnit, displayExchangeRate } = useBalance()
  const formattedCredits = new Intl.NumberFormat(locale).format(credits ?? 0)
  const fiat = formatFiatEquivalent({
    credits: credits ?? 0,
    displayCurrency,
    creditsPerMinorUnit,
    displayExchangeRate,
    locale,
  })
  const caption = failingCaption
    ? failingCaption
    : [
        fiat ? `About ${fiat}.` : null,
        merchantName ? interpolate(worksAcross, { merchant: merchantName }) : null,
      ]
        .filter(Boolean)
        .join(' ')

  return (
    <div className="solvapay-mcp-balance-strip">
      <Eyebrow variant="rail">{creditBalanceLabel}</Eyebrow>
      <p className="solvapay-mcp-balance-hero">
        {formattedCredits}
        {' credits'}
      </p>
      {caption ? <p className="solvapay-mcp-muted">{caption}</p> : null}
    </div>
  )
}

export function formatFiatEquivalent({
  credits,
  displayCurrency,
  creditsPerMinorUnit,
  displayExchangeRate,
  locale,
}: {
  credits: number
  displayCurrency: string | null
  creditsPerMinorUnit: number | null
  displayExchangeRate: number | null
  locale: string
}): string | null {
  if (!displayCurrency || !creditsPerMinorUnit) return null
  const displayMinor = creditsToDisplayMinorUnits({
    credits,
    creditsPerMinorUnit,
    displayExchangeRate: displayExchangeRate ?? 1,
    displayCurrency,
  })
  if (displayMinor === null) return null
  const minorPerMajor = minorUnitsPerMajor(displayCurrency)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: displayCurrency,
    minimumFractionDigits: minorPerMajor === 1 ? 0 : 2,
  }).format(displayMinor / minorPerMajor)
}
