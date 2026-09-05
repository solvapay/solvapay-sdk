import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { McpDisplayModeProvider } from '../../hooks/useDisplayMode'
import { CloseButton } from '../CloseButton'

describe('<CloseButton>', () => {
  it('renders only in fullscreen and calls onClose', () => {
    const onClose = vi.fn()
    render(
      <McpDisplayModeProvider
        value={{
          displayMode: 'fullscreen',
          availableDisplayModes: ['inline', 'fullscreen'],
        }}
      >
        <CloseButton onClose={onClose} />
      </McpDisplayModeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('hides when the app is inline', () => {
    render(
      <McpDisplayModeProvider
        value={{
          displayMode: 'inline',
          availableDisplayModes: ['inline', 'fullscreen'],
        }}
      >
        <CloseButton onClose={vi.fn()} />
      </McpDisplayModeProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('hides when onClose is not wired', () => {
    render(
      <McpDisplayModeProvider
        value={{
          displayMode: 'fullscreen',
          availableDisplayModes: ['inline', 'fullscreen'],
        }}
      >
        <CloseButton />
      </McpDisplayModeProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})
