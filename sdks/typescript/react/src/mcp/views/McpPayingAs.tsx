'use client'

/**
 * Payment-form identity caption. Renders `Paying as {email}` only —
 * no merchant name, no middot join. Fullscreen stacks a muted label
 * over the email; inline is a single muted span.
 */

import React from 'react'
import { useCustomer } from '../../hooks/useCustomer'
import { useDisplayMode } from '../hooks/useDisplayMode'

export interface McpPayingAsProps {
  /** Override the signed-in customer email. */
  email?: string | null
}

export function McpPayingAs({ email }: McpPayingAsProps): React.ReactElement | null {
  const { email: customerEmail } = useCustomer()
  const { displayMode } = useDisplayMode()
  const resolved = (email ?? customerEmail)?.trim()
  if (!resolved) return null

  const variant = displayMode === 'fullscreen' ? 'stacked' : 'inline'

  if (variant === 'stacked') {
    return (
      <div className="solvapay-mcp-paying-as" data-variant="stacked">
        <span className="solvapay-mcp-paying-as-label">Paying as</span>
        <span className="solvapay-mcp-paying-as-email">{resolved}</span>
      </div>
    )
  }

  return (
    <span className="solvapay-mcp-paying-as" data-variant="inline">
      Paying as {resolved}
    </span>
  )
}
