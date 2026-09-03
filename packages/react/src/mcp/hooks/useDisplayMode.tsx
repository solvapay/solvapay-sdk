'use client'

/**
 * Display-mode context for MCP apps.
 *
 * `<McpApp>` reads `displayMode` / `availableDisplayModes` /
 * `containerDimensions` / `safeAreaInsets` from the host context and
 * mounts `<McpDisplayModeProvider>` so the shell and chrome can react
 * without each caller parsing `getHostContext()`.
 *
 * `useRequestDisplayMode()` returns the host's
 * `app.requestDisplayMode` bound through `<McpApp>`, or `undefined`
 * when the integrator's app adapter does not implement it. The
 * "Full view" control must not render in that case.
 */

import React, { createContext, useContext, useMemo } from 'react'
import {
  DEFAULT_DISPLAY_MODE_STATE,
  type McpDisplayMode,
  type McpDisplayModeState,
} from '../display-mode'

export type RequestDisplayMode = (mode: McpDisplayMode) => Promise<McpDisplayMode>

export interface McpDisplayModeContextValue extends McpDisplayModeState {
  requestDisplayMode?: RequestDisplayMode
}

const McpDisplayModeContext = createContext<McpDisplayModeContextValue>(DEFAULT_DISPLAY_MODE_STATE)

export interface McpDisplayModeProviderProps {
  value: McpDisplayModeContextValue
  children: React.ReactNode
}

export function McpDisplayModeProvider({ value, children }: McpDisplayModeProviderProps) {
  const stable = useMemo<McpDisplayModeContextValue>(
    () => ({
      displayMode: value.displayMode,
      availableDisplayModes: value.availableDisplayModes,
      containerDimensions: value.containerDimensions,
      safeAreaInsets: value.safeAreaInsets,
      requestDisplayMode: value.requestDisplayMode,
    }),
    [
      value.displayMode,
      value.availableDisplayModes,
      value.containerDimensions,
      value.safeAreaInsets,
      value.requestDisplayMode,
    ],
  )
  return <McpDisplayModeContext.Provider value={stable}>{children}</McpDisplayModeContext.Provider>
}

/** Current host display mode. Never throws; defaults to inline. */
export function useDisplayMode(): McpDisplayModeState {
  const { requestDisplayMode: _request, ...state } = useContext(McpDisplayModeContext)
  return state
}

/**
 * Ask the host to switch display mode. Returns `undefined` when the
 * app adapter does not expose `requestDisplayMode`.
 */
export function useRequestDisplayMode(): RequestDisplayMode | undefined {
  return useContext(McpDisplayModeContext).requestDisplayMode
}
