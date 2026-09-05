'use client'

/**
 * Fullscreen-only close control. The host owns window chrome; this is
 * our in-iframe dismiss. Hidden when inline, when already tearing
 * down, or when the integrator did not wire `onClose`.
 */

import React from 'react'
import { useDisplayMode } from '../hooks/useDisplayMode'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface CloseButtonProps {
  onClose?: () => void
  classNames?: McpViewClassNames
}

export function CloseButton({ onClose, classNames }: CloseButtonProps) {
  const cx = resolveMcpClassNames(classNames)
  const { displayMode } = useDisplayMode()

  if (displayMode !== 'fullscreen') return null
  if (!onClose) return null

  return (
    <button
      type="button"
      className={`${cx.linkButton} solvapay-mcp-close`.trim()}
      onClick={() => {
        onClose()
      }}
    >
      Close
    </button>
  )
}
