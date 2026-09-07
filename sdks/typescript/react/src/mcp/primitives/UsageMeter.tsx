'use client'

/**
 * MCP account-widget wrapper around the shared `<UsageMeter>`.
 *
 * Pins `warningAt=80` / `criticalAt=100` (shared defaults are 75/90) and
 * forces a warning when `remaining === 1` on a finite cap — E at 2 of 3
 * is a last-call warning, not a 67%=80% bug.
 */

import React from 'react'
import { UsageMeter, type UsageMeterRootProps } from '../../primitives/UsageMeter'
import { useUsage } from '../../hooks/useUsage'
import { cx } from './cx'

export const MCP_USAGE_WARNING_AT = 80
export const MCP_USAGE_CRITICAL_AT = 100

/**
 * `0` when remaining is the last call on a finite cap so the shared
 * percent gate still flips to warning below 80%. Otherwise 80.
 */
export function mcpUsageWarningAt(remaining: number | null | undefined): number {
  return remaining === 1 ? 0 : MCP_USAGE_WARNING_AT
}

export type McpUsageMeterProps = Omit<UsageMeterRootProps, 'warningAt' | 'criticalAt'>

export function McpUsageMeter({
  usageOverride,
  className,
  children,
  ...rest
}: McpUsageMeterProps): React.ReactElement {
  const hooked = useUsage()
  const usage = usageOverride !== undefined ? usageOverride : hooked.usage
  return (
    <UsageMeter.Root
      warningAt={mcpUsageWarningAt(usage?.remaining)}
      criticalAt={MCP_USAGE_CRITICAL_AT}
      usageOverride={usageOverride}
      className={cx('solvapay-mcp-usage-meter', className)}
      {...rest}
    >
      {children}
    </UsageMeter.Root>
  )
}
