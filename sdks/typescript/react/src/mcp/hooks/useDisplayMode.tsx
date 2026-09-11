'use client'

import React, { createContext, useContext, useMemo } from 'react'
import { DEFAULT_DISPLAY_MODE_STATE, type McpDisplayModeState } from '../display-mode'

const McpDisplayModeContext = createContext<McpDisplayModeState>(DEFAULT_DISPLAY_MODE_STATE)

export interface McpDisplayModeProviderProps {
  value: McpDisplayModeState
  children: React.ReactNode
}

export function McpDisplayModeProvider({ value, children }: McpDisplayModeProviderProps) {
  const stable = useMemo<McpDisplayModeState>(
    () => ({
      displayMode: value.displayMode,
      availableDisplayModes: value.availableDisplayModes,
      containerDimensions: value.containerDimensions,
      safeAreaInsets: value.safeAreaInsets,
      hostedRail: value.hostedRail,
    }),
    [
      value.displayMode,
      value.availableDisplayModes,
      value.containerDimensions,
      value.safeAreaInsets,
      value.hostedRail,
    ],
  )
  return <McpDisplayModeContext.Provider value={stable}>{children}</McpDisplayModeContext.Provider>
}

/** Current host display mode. Never throws; defaults to inline. */
export function useDisplayMode(): McpDisplayModeState {
  return useContext(McpDisplayModeContext)
}
