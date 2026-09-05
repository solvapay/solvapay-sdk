import { renderHook } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'
import type { McpDisplayModeState } from '../display-mode'
import { McpDisplayModeProvider, useDisplayMode } from './useDisplayMode'

function wrapper(value: McpDisplayModeState) {
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
