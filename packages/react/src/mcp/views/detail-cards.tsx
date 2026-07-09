'use client'

/**
 * `<McpCustomerDetailsCard>` / `<McpSellerDetailsCard>` — two small
 * identity cards shared between the account surface body and the
 * persistent wide-iframe sidebar.
 *
 * Kept intentionally primitive: no hooks beyond `useCustomer` /
 * `useMerchant`, no new CSS dependencies beyond the `solvapay-mcp-*`
 * convention. Callers stack them in either orientation (sidebar puts
 * Seller on top, narrow iframes put Customer on top).
 */

import React from 'react'
import { creditsToDisplayMinorUnits, resolveSellerIdentityDisplay } from '@solvapay/core'
import { useBalance } from '../../hooks/useBalance'
import { useCustomer } from '../../hooks/useCustomer'
import { useMerchant } from '../../hooks/useMerchant'
import { formatPrice } from '../../utils/format'
import { useHostLocale } from '../useHostLocale'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface McpCustomerDetailsCardProps {
  classNames?: McpViewClassNames
  /**
   * When provided, a "Top up" text button is rendered next to the
   * credit balance row. Typically wired to switch the active surface in
   * the `<McpAppShell>` so the in-iframe navigation stays shell-local.
   */
  onTopup?: () => void
  /**
   * Hides the credit balance row even when a non-zero balance is
   * present. Useful on an unlimited-plan customer whose `balance` is
   * populated but semantically meaningless.
   */
  hideBalance?: boolean
}

function DetailRow({
  label,
  value,
  mono,
  muted,
  labelMuted,
}: {
  label?: string
  value: string
  mono?: boolean
  muted?: string
  labelMuted?: string
}) {
  return (
    <>
      {label ? (
        <dt className={`solvapay-mcp-detail-label ${labelMuted ?? ''}`.trim()}>{label}</dt>
      ) : null}
      <dd
        className={`solvapay-mcp-detail-row solvapay-mcp-detail-value${mono ? ' solvapay-mcp-detail-value-mono' : ''} ${muted ?? ''}`.trim()}
      >
        {value}
      </dd>
    </>
  )
}

/**
 * Customer details — name, email, customer reference (monospaced, the
 * value users paste into support tickets). The credit balance row is
 * only rendered when `balance > 0` to avoid a "0 credits" row on a
 * brand-new account.
 */
export function McpCustomerDetailsCard({
  classNames,
  onTopup,
  hideBalance,
}: McpCustomerDetailsCardProps) {
  const cx = resolveMcpClassNames(classNames)
  const { name, email, customerRef, loading } = useCustomer()
  const { credits, displayCurrency, creditsPerMinorUnit, displayExchangeRate } = useBalance()
  const locale = useHostLocale()

  if (loading && !customerRef) {
    return (
      <section className={cx.card} aria-busy="true" aria-label="Your account">
        <h2 className={cx.heading}>Your account</h2>
        <p className={cx.muted}>Loading…</p>
      </section>
    )
  }

  const displayName = name?.trim() || 'Customer'
  const showBalance = !hideBalance && typeof credits === 'number' && credits > 0

  const displayMinor =
    showBalance &&
    typeof creditsPerMinorUnit === 'number' &&
    creditsPerMinorUnit > 0 &&
    displayCurrency
      ? creditsToDisplayMinorUnits({
          credits: credits ?? 0,
          creditsPerMinorUnit,
          displayExchangeRate: displayExchangeRate ?? 1,
          displayCurrency,
        })
      : null

  return (
    <section className={`${cx.card} solvapay-mcp-customer-card`.trim()} aria-label="Your account">
      <h2 className={cx.heading}>Your account</h2>
      <dl className="solvapay-mcp-detail-grid">
        <DetailRow value={displayName} muted={cx.muted} />
        {email ? <DetailRow value={email} muted={cx.muted} /> : null}
        {customerRef ? (
          <DetailRow
            label="Customer reference"
            value={customerRef}
            mono
            labelMuted={cx.muted}
            muted={cx.muted}
          />
        ) : null}

        {showBalance ? (
          <dd className="solvapay-mcp-detail-row solvapay-mcp-detail-balance-row">
            <div className="solvapay-mcp-detail-balance-copy">
              <span className="solvapay-mcp-detail-value">
                {Intl.NumberFormat(locale).format(credits ?? 0)} credits
              </span>
              {displayMinor !== null ? (
                <span className={`solvapay-mcp-detail-value-mono ${cx.muted}`.trim()}>
                  ~{formatPrice(displayMinor, displayCurrency ?? 'USD', { locale, free: '' })}
                </span>
              ) : null}
            </div>
            {onTopup ? (
              <button
                type="button"
                className={cx.linkButton}
                onClick={onTopup}
                aria-label="Top up credits"
              >
                Top up
              </button>
            ) : null}
          </dd>
        ) : null}
      </dl>
    </section>
  )
}

export interface McpSellerDetailsCardProps {
  classNames?: McpViewClassNames
  /** Render the "Verified seller" trust badge next to the heading. */
  showVerifiedBadge?: boolean
}

/**
 * Seller details — company name, legal entity, support email/URL,
 * terms link. Compliance-relevant: a customer paying through the
 * iframe should see who they're actually paying, to the same level of
 * detail as hosted checkout.
 */
export function McpSellerDetailsCard({
  classNames,
  showVerifiedBadge = true,
}: McpSellerDetailsCardProps) {
  const cx = resolveMcpClassNames(classNames)
  const { merchant, loading } = useMerchant()

  if (loading && !merchant) {
    return (
      <section className={cx.card} aria-busy="true" aria-label="Seller">
        <h2 className={cx.heading}>Seller</h2>
        <p className={cx.muted}>Loading…</p>
      </section>
    )
  }

  if (!merchant) {
    return null
  }

  const supportEmail = merchant.supportEmail
  const supportUrl = merchant.supportUrl

  const sellerIdentity = resolveSellerIdentityDisplay({
    country: merchant.country,
    vatNumber: merchant.vatNumber,
    taxId: merchant.taxId,
    companyNumber: merchant.companyNumber,
  })

  return (
    <section className={cx.card} aria-label="Seller">
      <header className="solvapay-mcp-detail-heading-row">
        <h2 className={cx.heading}>Seller</h2>
        {showVerifiedBadge ? (
          <span className="solvapay-mcp-verified-badge" aria-label="Verified seller">
            <span aria-hidden="true">✓</span> Verified seller
          </span>
        ) : null}
      </header>

      <dl className="solvapay-mcp-detail-grid">
        <DetailRow value={merchant.displayName} muted={cx.muted} />
        {merchant.legalName && merchant.legalName !== merchant.displayName ? (
          <DetailRow value={merchant.legalName} muted={cx.muted} />
        ) : null}

        {supportEmail ? (
          <dd className="solvapay-mcp-detail-row">
            <a className="solvapay-mcp-detail-link" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
          </dd>
        ) : null}

        {supportUrl ? (
          <dd className="solvapay-mcp-detail-row">
            <a
              className="solvapay-mcp-detail-link"
              href={supportUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Support centre
            </a>
          </dd>
        ) : null}

        {sellerIdentity.companyNumber ? (
          <DetailRow
            label={sellerIdentity.companyNumber.label}
            value={sellerIdentity.companyNumber.value}
            mono
            labelMuted={cx.muted}
            muted={cx.muted}
          />
        ) : null}

        {sellerIdentity.taxIdentifier ? (
          <DetailRow
            label={sellerIdentity.taxIdentifier.label}
            value={sellerIdentity.taxIdentifier.value}
            mono
            labelMuted={cx.muted}
            muted={cx.muted}
          />
        ) : null}

        {merchant.country ? (
          <DetailRow label="Country" value={merchant.country} labelMuted={cx.muted} />
        ) : null}
      </dl>
    </section>
  )
}
