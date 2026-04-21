'use client'

/**
 * `<McpUsageView>` — the usage screen surfaced by the `open_usage` MCP
 * tool. Composes `<UsageMeter>` with contextual top-up / upgrade CTAs.
 */

import React from 'react'
import { useCopy } from '../../hooks/useCopy'
import { usePurchase } from '../../hooks/usePurchase'
import { useUsage } from '../../hooks/useUsage'
import { UsageMeter } from '../../primitives/UsageMeter'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface McpUsageViewProps {
  classNames?: McpViewClassNames
  /**
   * Called when the user clicks the top-up CTA. Consumers typically wire
   * this to an `open_topup` tool call or inline `<McpTopupView>` mount.
   */
  onRequestTopup?: () => void
  /**
   * Called when the user clicks the upgrade CTA. Consumers typically wire
   * this to an `open_checkout` tool call.
   */
  onRequestUpgrade?: () => void
}

export function McpUsageView({
  classNames,
  onRequestTopup,
  onRequestUpgrade,
}: McpUsageViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const copy = useCopy()
  const { loading: purchaseLoading, activePurchase } = usePurchase()
  const { usage, isApproachingLimit, isAtLimit, refetch } = useUsage()

  if (purchaseLoading) {
    return (
      <div className={cx.card}>
        <p>{copy.usage.loadingLabel}</p>
      </div>
    )
  }

  const planType = activePurchase?.planSnapshot?.planType
  const allowsTopup = planType === 'usage-based'
  const productName = activePurchase?.productName ?? null
  const planName = activePurchase?.planSnapshot?.name ?? null

  return (
    <div className={cx.card}>
      {productName && <h2 className={cx.heading}>{productName}</h2>}
      {planName && <p className={cx.muted}>{planName}</p>}

      <UsageMeter.Root>
        <UsageMeter.Label />
        <UsageMeter.Bar />
        <UsageMeter.Percentage />
        <UsageMeter.ResetsIn />
        <UsageMeter.Loading />
        <UsageMeter.Empty />
      </UsageMeter.Root>

      {isAtLimit && <p className={cx.error}>{copy.usage.atLimit}</p>}
      {!isAtLimit && isApproachingLimit && (
        <p className={cx.notice}>{copy.usage.approachingLimit}</p>
      )}

      {usage && (
        <div className={cx.balanceRow}>
          {allowsTopup ? (
            <button
              type="button"
              className={cx.button}
              onClick={onRequestTopup}
              disabled={!onRequestTopup}
            >
              {copy.usage.topUpCta}
            </button>
          ) : (
            <button
              type="button"
              className={cx.button}
              onClick={onRequestUpgrade}
              disabled={!onRequestUpgrade}
            >
              {copy.usage.upgradeCta}
            </button>
          )}
          <button
            type="button"
            className={cx.linkButton}
            onClick={() => {
              void refetch()
            }}
          >
            {copy.usage.refreshCta}
          </button>
        </div>
      )}
    </div>
  )
}
