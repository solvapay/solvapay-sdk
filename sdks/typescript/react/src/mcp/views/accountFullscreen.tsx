'use client'

/**
 * Fullscreen-only account additions: credit activity (B/D), charges (C),
 * and the merchant/buyer identity footer (A–D).
 */

import React from 'react'
import type { CreditActivityResult, PurchaseInfo } from '@solvapay/server'
import { ExternalLinkGlyph } from '../../components/ExternalLinkGlyph'
import { LaunchCustomerPortalButton } from '../../components/LaunchCustomerPortalButton'
import { useCopy, useLocale } from '../../hooks/useCopy'
import { useCustomer } from '../../hooks/useCustomer'
import { useExternalLinkClick } from '../../hooks/useExternalLink'
import { useMerchant } from '../../hooks/useMerchant'
import { interpolate } from '../../i18n/interpolate'
import { Eyebrow } from '../primitives'
import {
  formatMerchantPlace,
  mapChargeRow,
  mapCreditActivityRow,
  websiteHostLabel,
} from '../history-rows'

export function CreditActivitySection({
  entries,
  loading,
  error,
}: {
  entries: CreditActivityResult['entries'] | null
  loading: boolean
  error: Error | null
}): React.ReactElement {
  const copy = useCopy()
  return (
    <section className="solvapay-mcp-history" data-kind="credits" aria-busy={loading || undefined}>
      <div className="solvapay-mcp-history-head">
        <Eyebrow variant="step">{copy.account.creditActivityEyebrow}</Eyebrow>
        <PortalTextLink>{copy.account.fullHistory}</PortalTextLink>
      </div>
      {error ? (
        <p className="solvapay-mcp-muted" role="alert">
          {copy.account.creditActivityFailed}
        </p>
      ) : entries && entries.length === 0 ? (
        <p className="solvapay-mcp-muted" role="status">
          {copy.account.creditActivityEmpty}
        </p>
      ) : entries && entries.length > 0 ? (
        <CreditActivityTable entries={entries} />
      ) : null}
      <p className="solvapay-mcp-muted">{copy.account.creditActivityCaption}</p>
    </section>
  )
}

function CreditActivityTable({
  entries,
}: {
  entries: CreditActivityResult['entries']
}): React.ReactElement {
  const copy = useCopy()
  const locale = useLocale() ?? 'en'
  return (
    <table className="solvapay-mcp-history-table" data-kind="credits">
      <thead>
        <tr>
          <th scope="col">{copy.account.eventColumn}</th>
          <th scope="col">{copy.account.whenColumn}</th>
          <th scope="col">{copy.account.creditsColumn}</th>
          <th scope="col">{copy.account.balanceColumn}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => {
          const row = mapCreditActivityRow(entry, locale)
          return (
            <tr key={`${entry.timestamp}:${entry.type}:${entry.amount}:${index}`}>
              <td>
                <span className="solvapay-mcp-history-title">{row.title}</span>
                {row.subtitle ? (
                  <span className="solvapay-mcp-history-subtitle">{row.subtitle}</span>
                ) : null}
              </td>
              <td>{row.when}</td>
              <td data-align="right">{row.credits}</td>
              <td data-align="right">{row.balance}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function ChargesSection({
  charges,
  loading,
  error,
}: {
  charges: PurchaseInfo[] | null
  loading: boolean
  error: Error | null
}): React.ReactElement {
  const copy = useCopy()
  return (
    <section className="solvapay-mcp-history" data-kind="charges" aria-busy={loading || undefined}>
      <div className="solvapay-mcp-history-head">
        <Eyebrow variant="step">{copy.account.chargesEyebrow}</Eyebrow>
      </div>
      {error ? (
        <p className="solvapay-mcp-muted" role="alert">
          {copy.account.chargesFailed}
        </p>
      ) : charges && charges.length === 0 ? (
        <p className="solvapay-mcp-muted" role="status">
          {copy.account.chargesEmpty}
        </p>
      ) : charges && charges.length > 0 ? (
        <ChargesTable charges={charges} />
      ) : null}
    </section>
  )
}

function ChargesTable({ charges }: { charges: PurchaseInfo[] }): React.ReactElement {
  const copy = useCopy()
  const locale = useLocale() ?? 'en'
  return (
    <table className="solvapay-mcp-history-table" data-kind="charges">
      <thead>
        <tr>
          <th scope="col">{copy.account.chargeColumn}</th>
          <th scope="col">{copy.account.dateColumn}</th>
          <th scope="col">{copy.account.amountColumn}</th>
        </tr>
      </thead>
      <tbody>
        {charges.map(purchase => {
          const row = mapChargeRow(purchase, locale)
          return (
            <tr key={purchase.reference}>
              <td>{row.charge}</td>
              <td>{row.date}</td>
              <td data-align="right">{row.amount}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function AccountIdentityFooter(): React.ReactElement {
  const copy = useCopy()
  const { merchant } = useMerchant()
  const { name, email } = useCustomer()
  const handleExternalClick = useExternalLinkClick()
  const place = merchant ? formatMerchantPlace(merchant) : null
  const websiteUrl = merchant?.websiteUrl
  const websiteLabel = websiteUrl ? websiteHostLabel(websiteUrl) : null

  return (
    <footer className="solvapay-mcp-account-footer">
      <div className="solvapay-mcp-account-footer-merchant">
        {merchant?.displayName ? (
          <span>{interpolate(copy.account.soldBy, { merchant: merchant.displayName })}</span>
        ) : null}
        {place ? <span className="solvapay-mcp-muted">{place}</span> : null}
        {websiteUrl && websiteLabel ? (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="solvapay-mcp-history-link"
            aria-label={`${websiteLabel} (opens in a new tab)`}
            onClick={handleExternalClick}
          >
            {websiteLabel}
            <ExternalLinkGlyph />
          </a>
        ) : null}
      </div>
      <div className="solvapay-mcp-account-footer-buyer">
        {name ? <span>{name}</span> : null}
        {email ? <span className="solvapay-mcp-muted">{email}</span> : null}
        <PortalTextLink>{copy.account.fullAccount}</PortalTextLink>
      </div>
    </footer>
  )
}

function PortalTextLink({ children }: { children: string }): React.ReactElement {
  return (
    <LaunchCustomerPortalButton className="solvapay-mcp-history-link">
      {children}
    </LaunchCustomerPortalButton>
  )
}
