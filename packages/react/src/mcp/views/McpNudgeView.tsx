'use client'

/**
 * `<McpNudgeView>` — the view opened when a successful paywalled tool
 * response carries `options.nudge`.
 *
 * Renders `McpUpsellStrip` at the top, then a minimal preview of the
 * merchant's tool result (JSON). Best-effort UI for hosts that open
 * the MCP App resource on success responses; hosts that don't render
 * the iframe simply show the merchant data in-line via
 * `content[0].text`.
 */

import React from 'react'
import type { McpBootstrap } from '../bootstrap'
import { McpUpsellStrip } from '../components/McpUpsellStrip'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface McpNudgeViewProps {
  /**
   * Full bootstrap snapshot with `nudge` + `data` populated by
   * `buildPayableHandler`'s success branch.
   */
  bootstrap: McpBootstrap
  /** Invoked when the user clicks the upsell CTA. */
  onCta?: () => void
  /** Invoked when the user dismisses the strip. */
  onDismiss?: () => void
  classNames?: McpViewClassNames
}

export function McpNudgeView({ bootstrap, onCta, onDismiss, classNames }: McpNudgeViewProps) {
  const cx = resolveMcpClassNames(classNames)
  const { nudge, data } = bootstrap

  return (
    <section className="solvapay-mcp-nudge-view">
      {nudge ? (
        <McpUpsellStrip nudge={nudge} onCta={onCta} onDismiss={onDismiss} />
      ) : null}
      {data !== undefined ? (
        <div className={cx.card}>
          <h2 className={cx.heading}>Tool result</h2>
          <pre className="solvapay-mcp-nudge-data">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  )
}
