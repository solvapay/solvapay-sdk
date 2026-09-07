import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UsageMeter } from '../../../primitives/UsageMeter'
import type { UsageSnapshot } from '../../../hooks/useUsage'
import {
  MCP_USAGE_CRITICAL_AT,
  MCP_USAGE_WARNING_AT,
  McpUsageMeter,
  mcpUsageWarningAt,
} from '../UsageMeter'

vi.mock('../../../hooks/useUsage', async () => {
  const actual = await vi.importActual<typeof import('../../../hooks/useUsage')>(
    '../../../hooks/useUsage',
  )
  return {
    ...actual,
    useUsage: () => ({
      usage: null,
      loading: false,
      error: null,
      refetch: async () => undefined,
      percentUsed: null,
      isApproachingLimit: false,
      isAtLimit: false,
      isUnlimited: false,
      meterRef: null,
    }),
  }
})

function snapshot(partial: Partial<UsageSnapshot>): UsageSnapshot {
  return {
    meterRef: 'requests',
    used: 0,
    total: null,
    remaining: null,
    percentUsed: null,
    ...partial,
  }
}

describe('mcpUsageWarningAt', () => {
  it('pins the MCP warning threshold at 80', () => {
    expect(MCP_USAGE_WARNING_AT).toBe(80)
    expect(MCP_USAGE_CRITICAL_AT).toBe(100)
    expect(mcpUsageWarningAt(20)).toBe(80)
    expect(mcpUsageWarningAt(0)).toBe(80)
    expect(mcpUsageWarningAt(-1)).toBe(80)
    expect(mcpUsageWarningAt(null)).toBe(80)
  })

  it('overrides to last-call warning when remaining is 1 on a finite cap', () => {
    expect(mcpUsageWarningAt(1)).toBe(0)
  })
})

describe('McpUsageMeter', () => {
  it('pins warningAt=80 and criticalAt=100 so call sites cannot drift', () => {
    render(
      <McpUsageMeter
        usageOverride={snapshot({ used: 62, total: 100, remaining: 38, percentUsed: 62 })}
      >
        <UsageMeter.Bar />
      </McpUsageMeter>,
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'safe')
  })

  it('warns at 80% used', () => {
    render(
      <McpUsageMeter
        usageOverride={snapshot({ used: 80, total: 100, remaining: 20, percentUsed: 80 })}
      >
        <UsageMeter.Bar />
      </McpUsageMeter>,
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'warning')
  })

  it('is critical at 100%, not at the shared 90 default', () => {
    render(
      <McpUsageMeter
        usageOverride={snapshot({ used: 90, total: 100, remaining: 10, percentUsed: 90 })}
      >
        <UsageMeter.Bar />
      </McpUsageMeter>,
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'warning')

    render(
      <McpUsageMeter
        usageOverride={snapshot({ used: 100, total: 100, remaining: 0, percentUsed: 100 })}
      >
        <UsageMeter.Bar />
      </McpUsageMeter>,
    )
    const bars = screen.getAllByRole('progressbar')
    expect(bars[bars.length - 1]).toHaveAttribute('data-state', 'critical')
  })

  it('warns on the last remaining call even at 67% (E at 2 of 3)', () => {
    render(
      <McpUsageMeter
        usageOverride={snapshot({ used: 2, total: 3, remaining: 1, percentUsed: 67 })}
      >
        <UsageMeter.Bar />
      </McpUsageMeter>,
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-state', 'warning')
  })
})
