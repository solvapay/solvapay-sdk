import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { McpDisplayModeProvider } from '../../hooks/useDisplayMode'
import { FullViewButton } from '../FullViewButton'

describe('<FullViewButton>', () => {
  it('renders only when the host advertises fullscreen and the app is inline', () => {
    const requestDisplayMode = vi.fn().mockResolvedValue('fullscreen')
    render(
      <McpDisplayModeProvider
        value={{
          displayMode: 'inline',
          availableDisplayModes: ['inline', 'fullscreen'],
          requestDisplayMode,
        }}
      >
        <FullViewButton />
      </McpDisplayModeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Full view' }))
    expect(requestDisplayMode).toHaveBeenCalledWith('fullscreen')
  })

  it('hides when the host does not advertise fullscreen', () => {
    render(
      <McpDisplayModeProvider
        value={{
          displayMode: 'inline',
          availableDisplayModes: ['inline'],
          requestDisplayMode: vi.fn(),
        }}
      >
        <FullViewButton />
      </McpDisplayModeProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Full view' })).toBeNull()
  })

  it('hides when already fullscreen', () => {
    render(
      <McpDisplayModeProvider
        value={{
          displayMode: 'fullscreen',
          availableDisplayModes: ['inline', 'fullscreen'],
          requestDisplayMode: vi.fn(),
        }}
      >
        <FullViewButton />
      </McpDisplayModeProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Full view' })).toBeNull()
  })

  it('hides when the adapter cannot request a mode change', () => {
    render(
      <McpDisplayModeProvider
        value={{
          displayMode: 'inline',
          availableDisplayModes: ['inline', 'fullscreen'],
        }}
      >
        <FullViewButton />
      </McpDisplayModeProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Full view' })).toBeNull()
  })
})
