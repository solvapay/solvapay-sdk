'use client'

/**
 * Reduced limit-reached handoff. The backend reports only that a limit
 * was met — this panel names the product and sends the customer to
 * their account. It does not invent a cost, balance, or shortfall.
 */

import React from 'react'

export function McpLimitReached({
  productName,
  onOpenAccount,
}: {
  productName?: string
  onOpenAccount?: () => void
}): React.ReactElement {
  const title = productName ? `Limit reached for ${productName}` : 'Limit reached'
  return (
    <div className="solvapay-mcp-limit-reached" role="status">
      <h2 className="solvapay-mcp-limit-reached-title">{title}</h2>
      {onOpenAccount ? (
        <button type="button" className="solvapay-mcp-button" onClick={onOpenAccount}>
          Open account
        </button>
      ) : null}
    </div>
  )
}
