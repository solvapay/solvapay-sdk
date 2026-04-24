import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { McpUpsellStrip } from '../components/McpUpsellStrip'

describe('<McpUpsellStrip>', () => {
  it('renders the nudge message and the default CTA label per kind', () => {
    const onCta = vi.fn()
    const { rerender } = render(
      <McpUpsellStrip
        nudge={{ kind: 'low-balance', message: 'Running low on credits' }}
        onCta={onCta}
      />,
    )
    expect(screen.getByText('Running low on credits')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeTruthy()

    rerender(
      <McpUpsellStrip
        nudge={{ kind: 'cycle-ending', message: 'Renewing soon' }}
        onCta={onCta}
      />,
    )
    expect(screen.getByRole('button', { name: 'Renew' })).toBeTruthy()

    rerender(
      <McpUpsellStrip
        nudge={{ kind: 'approaching-limit', message: 'Near limit' }}
        onCta={onCta}
      />,
    )
    expect(screen.getByRole('button', { name: 'Upgrade' })).toBeTruthy()
  })

  it('hides locally when the dismiss button is clicked and invokes onDismiss', () => {
    const onDismiss = vi.fn()
    render(
      <McpUpsellStrip
        nudge={{ kind: 'low-balance', message: 'go away' }}
        onDismiss={onDismiss}
      />,
    )
    const dismiss = screen.getByRole('button', { name: 'Dismiss' })
    fireEvent.click(dismiss)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('mcp-upsell-strip')).toBeNull()
  })

  it('invokes onCta when the CTA button is clicked', () => {
    const onCta = vi.fn()
    render(
      <McpUpsellStrip
        nudge={{ kind: 'low-balance', message: 'Upgrade now' }}
        onCta={onCta}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Upgrade' }))
    expect(onCta).toHaveBeenCalledTimes(1)
  })

  it('respects hideDismiss', () => {
    render(
      <McpUpsellStrip
        nudge={{ kind: 'low-balance', message: 'persistent' }}
        hideDismiss
      />,
    )
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })
})
