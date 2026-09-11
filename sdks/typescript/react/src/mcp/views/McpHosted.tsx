'use client'

/**
 * Hosted-page layout primitives for the MCP widget.
 *
 * Inline stays a single-column stack. Fullscreen stamps
 * `data-rail="hosted"`; the 340px payment split engages only when
 * `@container mcp-hosted (min-width: 1000px)` matches the measured
 * width. Management stays one column. Same React tree — CSS
 * container queries flip the payment geometry. Host-reported
 * `containerDimensions` are not trusted for this gate.
 */

import React from 'react'
import { resolveHostedRail } from '../display-mode'
import { useDisplayMode } from '../hooks/useDisplayMode'

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
  const displayMode = useDisplayMode()
  const rail = resolveHostedRail(displayMode)
  return (
    <div className="solvapay-mcp-hosted-layout" data-rail={rail}>
      {children}
    </div>
  )
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
