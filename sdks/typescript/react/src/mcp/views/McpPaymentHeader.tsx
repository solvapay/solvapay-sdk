'use client'

/**
 * Shared chrome for the three MCP payment steps. Fullscreen stacks
 * BackLink → optional heading → Paying as; inline puts BackLink and
 * Paying as on one `space-between` row, then the optional heading.
 * Branching is in JS, not CSS `order`.
 */

import React from 'react'
import { useDisplayMode } from '../hooks/useDisplayMode'
import { BackLink } from './BackLink'
import { McpPayingAs } from './McpPayingAs'
import { resolveMcpClassNames, type McpViewClassNames } from './types'

export interface McpPaymentHeaderProps {
  backLabel: string
  onBack: () => void
  heading?: string
  /** Integrator override for the heading slot. Falls through to the default. */
  headingClassName?: string
  classNames?: McpViewClassNames
}

export function McpPaymentHeader({
  backLabel,
  onBack,
  heading,
  headingClassName,
  classNames,
}: McpPaymentHeaderProps): React.ReactElement {
  const cx = resolveMcpClassNames(classNames)
  const { displayMode } = useDisplayMode()
  const isFullscreen = displayMode === 'fullscreen'
  const title = heading ? <h2 className={headingClassName ?? cx.heading}>{heading}</h2> : null
  const back = <BackLink label={backLabel} onClick={onBack} />
  const payingAs = <McpPayingAs />

  if (isFullscreen) {
    return (
      <>
        {back}
        {title}
        {payingAs}
      </>
    )
  }

  return (
    <>
      <div className="solvapay-mcp-form-identity-row">
        {back}
        {payingAs}
      </div>
      {title}
    </>
  )
}
