import { render } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { McpDisplayModeProvider } from '../../hooks/useDisplayMode'
import { McpHostedColumn, McpHostedLayout, McpSummaryRail } from '../McpHosted'

describe('<McpHostedLayout>', () => {
  it('stamps the inline rail in inline mode', () => {
    const { container } = render(
      <McpDisplayModeProvider
        value={{ displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] }}
      >
        <McpHostedLayout>
          <McpSummaryRail>summary</McpSummaryRail>
        </McpHostedLayout>
      </McpDisplayModeProvider>,
    )
    expect(container.querySelector('.solvapay-mcp-hosted-layout')).toHaveAttribute(
      'data-rail',
      'inline',
    )
  })

  it('stamps the hosted rail in fullscreen when the host width is unknown', () => {
    const { container } = render(
      <McpDisplayModeProvider
        value={{ displayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] }}
      >
        <McpHostedLayout>
          <McpSummaryRail>summary</McpSummaryRail>
        </McpHostedLayout>
      </McpDisplayModeProvider>,
    )
    expect(container.querySelector('.solvapay-mcp-hosted-layout')).toHaveAttribute(
      'data-rail',
      'hosted',
    )
  })

  it('stamps the hosted rail in fullscreen even when the host reports a stale 720px width', () => {
    const { container } = render(
      <McpDisplayModeProvider
        value={{
          displayMode: 'fullscreen',
          availableDisplayModes: ['inline', 'fullscreen'],
          containerDimensions: { width: 720 },
        }}
      >
        <McpHostedLayout>
          <McpSummaryRail>summary</McpSummaryRail>
        </McpHostedLayout>
      </McpDisplayModeProvider>,
    )
    expect(container.querySelector('.solvapay-mcp-hosted-layout')).toHaveAttribute(
      'data-rail',
      'hosted',
    )
  })
})

describe('<McpHostedColumn>', () => {
  it('stamps management so CSS can keep the single column', () => {
    const { container } = render(
      <McpHostedColumn surface="management">account</McpHostedColumn>,
    )
    expect(container.querySelector('.solvapay-mcp-hosted')).toHaveAttribute(
      'data-mcp-surface',
      'management',
    )
  })
})
