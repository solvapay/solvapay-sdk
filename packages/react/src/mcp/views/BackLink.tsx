'use client'

/**
 * `<BackLink>` — shared muted `← label` navigation primitive used by
 * Top up steps, Plan sub-flows, and cancel-confirmation.
 *
 * Mirrors the hosted `CheckoutShell.tsx`'s "← Back to my account"
 * affordance so the MCP shell and the hosted manage page ship with
 * identical back-nav vocabulary. Consumers pass a `label` and an
 * `onClick`; the glyph + style comes for free.
 */

import React from 'react'

export interface BackLinkProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Visible label; typically `"Back to my account"` or `"Change amount"`. */
  label: string
  /** Optional override for the arrow glyph (defaults to `←`). */
  glyph?: string
}

export function BackLink({ label, glyph = '←', className, onClick, ...rest }: BackLinkProps) {
  return (
    <button
      type="button"
      className={['solvapay-mcp-back-link', className].filter(Boolean).join(' ')}
      onClick={onClick}
      {...rest}
    >
      <span className="solvapay-mcp-back-link-glyph" aria-hidden="true">
        {glyph}{' '}
      </span>
      {label}
    </button>
  )
}
