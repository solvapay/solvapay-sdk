'use client'

/**
 * `<McpUpsellStrip>` — inline upsell banner rendered below a successful
 * paywalled tool response carrying `options.nudge`.
 *
 * Dismissible, non-blocking. Default CTA per kind opens the `upgrade`
 * intent tool; consumers can override via `onCta`. Hosts that don't
 * render the SolvaPay MCP App UI silently drop the strip (the nudge
 * metadata is just ignored) — text-mode hosts still get the merchant
 * data in `structuredContent` + `content[0]`.
 */

import React, { useState } from 'react'
import type { NudgeSpec } from '@solvapay/mcp'

export interface McpUpsellStripProps {
  nudge: NudgeSpec
  /**
   * Invoked when the user clicks the CTA. Default CTA per kind is
   * "Upgrade" / "Renew"; consumers wire this to `openUpgrade()` in
   * their MCP App shell.
   */
  onCta?: () => void
  /**
   * Invoked when the user dismisses the strip. The strip hides locally
   * regardless of whether a handler is wired.
   */
  onDismiss?: () => void
  /** Suppress the dismiss button for sticky nudges. Defaults to false. */
  hideDismiss?: boolean
  /** Override the default CTA label. */
  ctaLabel?: string
  /** Override the root element class (intentionally narrow hook). */
  className?: string
}

interface NudgeDefaults {
  label: string
}

const NUDGE_DEFAULTS: Record<NudgeSpec['kind'], NudgeDefaults> = {
  'low-balance': { label: 'Upgrade' },
  'cycle-ending': { label: 'Renew' },
  'approaching-limit': { label: 'Upgrade' },
}

export function McpUpsellStrip({
  nudge,
  onCta,
  onDismiss,
  hideDismiss = false,
  ctaLabel,
  className,
}: McpUpsellStripProps) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const label = ctaLabel ?? NUDGE_DEFAULTS[nudge.kind].label

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  const rootClass = [
    'solvapay-mcp-upsell-strip',
    `solvapay-mcp-upsell-strip--${nudge.kind}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <aside className={rootClass} role="status" aria-live="polite" data-testid="mcp-upsell-strip">
      <span className="solvapay-mcp-upsell-strip-message">{nudge.message}</span>
      <div className="solvapay-mcp-upsell-strip-actions">
        {onCta ? (
          <button
            type="button"
            onClick={onCta}
            className="solvapay-mcp-upsell-strip-cta"
          >
            {label}
          </button>
        ) : null}
        {hideDismiss ? null : (
          <button
            type="button"
            onClick={handleDismiss}
            className="solvapay-mcp-upsell-strip-dismiss"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </aside>
  )
}
