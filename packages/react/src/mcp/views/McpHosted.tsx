'use client'

/**
 * Hosted-page layout primitives for the MCP widget.
 *
 * Inline stays a single-column stack. Fullscreen at ≥1000px of host
 * width becomes the hosted page: payment leads with a 340px summary
 * rail, management trails a 300px context rail. Same React tree —
 * CSS container queries flip the geometry.
 */

import React from 'react'

export function McpHostedColumn({
  surface,
  children,
}: {
  surface: 'payment' | 'management'
  children: React.ReactNode
}) {
  return (
    <div className="solvapay-mcp-hosted" data-mcp-surface={surface}>
      {children}
    </div>
  )
}

export function McpHostedLayout({ children }: { children: React.ReactNode }) {
  return <div className="solvapay-mcp-hosted-layout">{children}</div>
}

export function McpSummaryRail({ children }: { children: React.ReactNode }) {
  return <aside className="solvapay-mcp-summary-rail">{children}</aside>
}

export function McpContextRail({ children }: { children: React.ReactNode }) {
  return <aside className="solvapay-mcp-context-rail">{children}</aside>
}

export function McpHostedBody({ children }: { children: React.ReactNode }) {
  return <div className="solvapay-mcp-hosted-body">{children}</div>
}
