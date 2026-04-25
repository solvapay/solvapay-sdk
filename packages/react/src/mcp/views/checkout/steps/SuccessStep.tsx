'use client'

/**
 * Step 4 — shared success surface. Renders a PAYG or recurring
 * receipt depending on the branch that produced the success, plus a
 * `Back to chat` CTA that unmounts the view.
 */

import React, { memo } from 'react'
import { formatPrice } from '../../../../utils/format'
import { useHostLocale } from '../../../useHostLocale'
import type { Cx, SuccessMeta } from '../shared'

interface SuccessStepProps {
  meta: SuccessMeta
  onBackToChat: () => Promise<void>
  cx: Cx
}

export const SuccessStep = memo(function SuccessStep({
  meta,
  onBackToChat,
  cx,
}: SuccessStepProps) {
  const locale = useHostLocale()
  if (meta.branch === 'payg') {
    return (
      <>
        <div className="solvapay-mcp-checkout-success-check" aria-hidden="true">
          ✓
        </div>
        <h2 className={cx.heading}>Credits added</h2>
        <p className={cx.muted}>Pay as you go plan is active.</p>

        <dl className="solvapay-mcp-checkout-receipt" data-variant="payg">
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Amount</dt>
            <dd>{formatPrice(meta.amountMinor, meta.currency, { locale })}</dd>
          </div>
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Credits</dt>
            <dd>+{meta.creditsAdded.toLocaleString(locale)}</dd>
          </div>
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Plan</dt>
            <dd>{meta.plan.name ?? 'Pay as you go'}</dd>
          </div>
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Rate</dt>
            <dd>{meta.rateLabel}</dd>
          </div>
        </dl>

        <button
          type="button"
          className={cx.button}
          data-variant="success"
          onClick={() => {
            void onBackToChat()
          }}
        >
          Back to chat
        </button>
      </>
    )
  }

  return (
    <>
      <div className="solvapay-mcp-checkout-success-check" aria-hidden="true">
        ✓
      </div>
      <h2 className={cx.heading}>{meta.plan.name ?? 'Plan'} active</h2>
      <p className={cx.muted}>Subscription is live and credits are ready.</p>

      <dl className="solvapay-mcp-checkout-receipt" data-variant="recurring">
        <div className="solvapay-mcp-checkout-receipt-row">
          <dt>Plan</dt>
          <dd>{meta.plan.name ?? 'Plan'}</dd>
        </div>
        {meta.creditsIncluded > 0 ? (
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Credits</dt>
            <dd>+{meta.creditsIncluded.toLocaleString(locale)}</dd>
          </div>
        ) : null}
        <div className="solvapay-mcp-checkout-receipt-row">
          <dt>Charged today</dt>
          <dd>{formatPrice(meta.chargedTodayMinor, meta.currency, { locale })}</dd>
        </div>
        {meta.nextRenewalLabel ? (
          <div className="solvapay-mcp-checkout-receipt-row">
            <dt>Next renewal</dt>
            <dd>{meta.nextRenewalLabel}</dd>
          </div>
        ) : null}
      </dl>

      <p className={`${cx.muted} solvapay-mcp-checkout-manage-pointer`.trim()}>
        Manage from <code>/manage_account</code>
      </p>

      <button
        type="button"
        className={cx.button}
        data-variant="success"
        onClick={() => {
          void onBackToChat()
        }}
      >
        Back to chat
      </button>
    </>
  )
})
