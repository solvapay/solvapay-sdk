'use client'

/**
 * `<McpCustomerDetailsCard>` / `<McpSellerDetailsCard>` — two small
 * identity cards shared between the `Account` tab body and the
 * persistent wide-iframe sidebar.
 *
 * Kept intentionally primitive: no hooks beyond `useCustomer` /
 * `useMerchant`, no new CSS dependencies beyond the `solvapay-mcp-*`
 * convention. Callers stack them in either orientation (sidebar puts
 * Seller on top, Account tab on narrow iframes puts Customer on top).
 */

import React from 'react'
import { useBalance } from '../../hooks/useBalance'
import { useCustomer } from '../../hooks/useCustomer'
import { useMerchant } from '../../hooks/useMerchant'
import { useHostLocale } from '../useHostLocale'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface McpCustomerDetailsCardProps {
  classNames?: McpViewClassNames
  /**
   * When provided, a "Top up" text button is rendered next to the
   * Credit balance row. Typically wired to switch the active tab in
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
    <div className="solvapay-mcp-detail-row">
      {label ? (
        <span className={`solvapay-mcp-detail-label ${labelMuted ?? ''}`.trim()}>{label}</span>
      ) : null}
      <span
        className={`solvapay-mcp-detail-value${mono ? ' solvapay-mcp-detail-value-mono' : ''} ${muted ?? ''}`.trim()}
      >
        {value}
      </span>
    </div>
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
      <div className={cx.card} aria-busy="true">
        <h2 className={cx.heading}>Your details</h2>
        <p className={cx.muted}>Loading…</p>
      </div>
    )
  }

  const displayName = name?.trim() || 'Customer'
  const showBalance =
    !hideBalance && typeof credits === 'number' && credits > 0

  const approxValue =
    showBalance &&
    typeof creditsPerMinorUnit === 'number' &&
    creditsPerMinorUnit > 0 &&
    displayCurrency
      ? (credits / creditsPerMinorUnit) * (displayExchangeRate ?? 1)
      : null

  return (
    <section className={cx.card} aria-label="Your details">
      <h2 className={cx.heading}>Your details</h2>
      <div className="solvapay-mcp-detail-grid">
        <DetailRow value={displayName} muted={cx.muted} />
        {email ? <DetailRow label="Email" value={email} labelMuted={cx.muted} /> : null}
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
          <div className="solvapay-mcp-detail-row">
            <div className="solvapay-mcp-detail-balance-head">
              <span className={`solvapay-mcp-detail-label ${cx.muted}`.trim()}>Credit balance</span>
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
            </div>
            <span className="solvapay-mcp-detail-value">
              {Intl.NumberFormat(locale).format(credits ?? 0)} credits
            </span>
            {approxValue !== null ? (
              <span className={`solvapay-mcp-detail-value-mono ${cx.muted}`.trim()}>
                ~
                {Intl.NumberFormat(locale, {
                  style: 'currency',
                  currency: (displayCurrency ?? 'USD').toUpperCase(),
                  maximumFractionDigits: 2,
                }).format(approxValue)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
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
 *
 * Currently pulls from `useMerchant()` only (no org number, postal
 * address, or public website — those fields aren't on the SDK's
 * `SdkMerchantResponseDto`). If / when the backend surfaces them, add
 * them here.
 */
export function McpSellerDetailsCard({
  classNames,
  showVerifiedBadge = true,
}: McpSellerDetailsCardProps) {
  const cx = resolveMcpClassNames(classNames)
  const { merchant, loading } = useMerchant()

  if (loading && !merchant) {
    return (
      <div className={cx.card} aria-busy="true">
        <h2 className={cx.heading}>Seller details</h2>
        <p className={cx.muted}>Loading…</p>
      </div>
    )
  }

  if (!merchant) {
    return null
  }

  const supportEmail = merchant.supportEmail
  const supportUrl = merchant.supportUrl

  return (
    <section className={cx.card} aria-label="Seller details">
      <div className="solvapay-mcp-detail-heading-row">
        <h2 className={cx.heading}>Seller details</h2>
        {showVerifiedBadge ? (
          <span className="solvapay-mcp-verified-badge" aria-label="Verified seller">
            <span aria-hidden="true">✓</span> Verified seller
          </span>
        ) : null}
      </div>

      <div className="solvapay-mcp-detail-grid">
        <DetailRow value={merchant.displayName} muted={cx.muted} />
        {merchant.legalName && merchant.legalName !== merchant.displayName ? (
          <DetailRow value={merchant.legalName} muted={cx.muted} />
        ) : null}

        {supportEmail ? (
          <div className="solvapay-mcp-detail-row">
            <span className={`solvapay-mcp-detail-label ${cx.muted}`.trim()}>Support email</span>
            <a
              className="solvapay-mcp-detail-link"
              href={`mailto:${supportEmail}`}
            >
              {supportEmail}
            </a>
          </div>
        ) : null}

        {supportUrl ? (
          <div className="solvapay-mcp-detail-row">
            <span className={`solvapay-mcp-detail-label ${cx.muted}`.trim()}>Support</span>
            <a
              className="solvapay-mcp-detail-link"
              href={supportUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Visit support centre
            </a>
          </div>
        ) : null}

        {merchant.country ? (
          <DetailRow label="Country" value={merchant.country} labelMuted={cx.muted} />
        ) : null}
      </div>
    </section>
  )
}
