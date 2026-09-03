'use client'

/**
 * User-initiated "Full view" control. Hosts that advertise
 * `fullscreen` in `availableDisplayModes` get a button that calls
 * `app.requestDisplayMode({ mode: 'fullscreen' })`. Hidden when the
 * app is already fullscreen, when the host does not offer the mode,
 * or when the adapter has no `requestDisplayMode`.
 */

import React from 'react'
import { useDisplayMode, useRequestDisplayMode } from '../hooks/useDisplayMode'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface FullViewButtonProps {
  classNames?: McpViewClassNames
}

export function FullViewButton({ classNames }: FullViewButtonProps) {
  const cx = resolveMcpClassNames(classNames)
  const { displayMode, availableDisplayModes } = useDisplayMode()
  const requestDisplayMode = useRequestDisplayMode()

  if (!requestDisplayMode) return null
  if (displayMode === 'fullscreen') return null
  if (!availableDisplayModes.includes('fullscreen')) return null

  return (
    <button
      type="button"
      className={`${cx.linkButton} solvapay-mcp-full-view`.trim()}
      onClick={() => {
        void requestDisplayMode('fullscreen')
      }}
    >
      Full view
    </button>
  )
}
