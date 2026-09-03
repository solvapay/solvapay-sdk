import { renderHook } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { McpDisplayModeContextValue } from './useDisplayMode'
import { McpDisplayModeProvider, useDisplayMode, useRequestDisplayMode } from './useDisplayMode'

function wrapper(value: McpDisplayModeContextValue) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <McpDisplayModeProvider value={value}>{children}</McpDisplayModeProvider>
  }
}

describe('useDisplayMode', () => {
  it('defaults to inline with no advertised modes outside a provider', () => {
    const { result } = renderHook(() => useDisplayMode())
    expect(result.current).toEqual({
      displayMode: 'inline',
      availableDisplayModes: [],
    })
  })

  it('returns the host display-mode snapshot from the provider', () => {
    const { result } = renderHook(() => useDisplayMode(), {
      wrapper: wrapper({
        displayMode: 'fullscreen',
        availableDisplayModes: ['inline', 'fullscreen'],
      }),
    })
    expect(result.current.displayMode).toBe('fullscreen')
    expect(result.current.availableDisplayModes).toEqual(['inline', 'fullscreen'])
  })
})

describe('useRequestDisplayMode', () => {
  it('returns undefined when the host cannot switch modes', () => {
    const { result } = renderHook(() => useRequestDisplayMode())
    expect(result.current).toBeUndefined()
  })

  it('returns the bound request function from the provider', async () => {
    const requestDisplayMode = vi.fn().mockResolvedValue('fullscreen')
    const { result } = renderHook(() => useRequestDisplayMode(), {
      wrapper: wrapper({
        displayMode: 'inline',
        availableDisplayModes: ['inline', 'fullscreen'],
        requestDisplayMode,
      }),
    })
    await expect(result.current?.('fullscreen')).resolves.toBe('fullscreen')
    expect(requestDisplayMode).toHaveBeenCalledWith('fullscreen')
  })
})
