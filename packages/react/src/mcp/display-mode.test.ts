import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DISPLAY_MODE_STATE,
  hostSafeAreaPadding,
  isMcpDisplayMode,
  readDisplayModeState,
  SOLVAPAY_MCP_APP_CAPABILITIES,
} from './display-mode'

describe('readDisplayModeState', () => {
  it('returns the inline default when the host context is missing', () => {
    expect(readDisplayModeState(undefined)).toEqual(DEFAULT_DISPLAY_MODE_STATE)
    expect(readDisplayModeState(null)).toEqual(DEFAULT_DISPLAY_MODE_STATE)
  })

  it('keeps displayMode, availableDisplayModes, dimensions, and insets', () => {
    expect(
      readDisplayModeState({
        theme: 'dark',
        displayMode: 'fullscreen',
        availableDisplayModes: ['inline', 'fullscreen'],
        containerDimensions: { width: 1200, maxWidth: 1400 },
        safeAreaInsets: { top: 12, right: 0, bottom: 8, left: 0 },
      }),
    ).toEqual({
      displayMode: 'fullscreen',
      availableDisplayModes: ['inline', 'fullscreen'],
      containerDimensions: { width: 1200, height: undefined, maxWidth: 1400, maxHeight: undefined },
      safeAreaInsets: { top: 12, right: 0, bottom: 8, left: 0 },
    })
  })

  it('drops unknown display modes instead of inventing one', () => {
    expect(
      readDisplayModeState({
        displayMode: 'theater',
        availableDisplayModes: ['inline', 'theater', 'fullscreen'],
      }),
    ).toEqual({
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    })
  })
})

describe('hostSafeAreaPadding', () => {
  it('returns zeros when the host reports no insets', () => {
    expect(hostSafeAreaPadding(undefined)).toEqual({
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    })
  })

  it('maps hostContext.safeAreaInsets onto root padding', () => {
    expect(hostSafeAreaPadding({ top: 12, right: 0, bottom: 8, left: 4 })).toEqual({
      paddingTop: 12,
      paddingRight: 0,
      paddingBottom: 8,
      paddingLeft: 4,
    })
  })
})

describe('SOLVAPAY_MCP_APP_CAPABILITIES', () => {
  it('advertises inline and fullscreen only', () => {
    expect(SOLVAPAY_MCP_APP_CAPABILITIES.availableDisplayModes).toEqual(['inline', 'fullscreen'])
    expect(SOLVAPAY_MCP_APP_CAPABILITIES.availableDisplayModes.every(isMcpDisplayMode)).toBe(true)
  })
})
