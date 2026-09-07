'use client'

/**
 * `<LaunchCustomerPortalButton>` — opens the SolvaPay hosted customer
 * portal in a new browser tab.
 *
 * Render-eager: the button is enabled and labelled from the first paint
 * regardless of session state. The portal session URL is fetched in the
 * background through `useCustomerSessionUrl()` (a single in-flight call
 * shared across every instance under the same transport).
 *
 * Opening the portal always goes through `useExternalLink`, which
 * prefers the host's `ui/open-link` when one is mounted and otherwise
 * lets the browser navigate. That distinction matters inside MCP hosts:
 * Claude's iframe sandbox omits `allow-popups`, so both a bare
 * `<a target="_blank">` and `window.open()` are dropped without an
 * error — the button looks alive and does nothing.
 *
 * If the user clicks before the URL has resolved, the handler awaits
 * the in-flight fetch and then opens the resolved URL through the same
 * path, flipping to the error state if the open is refused.
 */

import React, { forwardRef, useState } from 'react'
import { useCustomerSessionUrl } from '../hooks/useCustomerSessionUrl'
import { useExternalLinkClick, useOpenExternal } from '../hooks/useExternalLink'
import { useCopy } from '../hooks/useCopy'
import { composeEventHandlers } from '../primitives/composeEventHandlers'
import { Slot } from '../primitives/slot'
import { ExternalLinkGlyph } from './ExternalLinkGlyph'

type ClickState = 'idle' | 'pending' | 'error'

export interface LaunchCustomerPortalButtonProps
  extends Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    'href' | 'target' | 'rel' | 'onError'
  > {
  /** Override the default "Manage account" label. */
  children?: React.ReactNode
  /** Called immediately before the user navigates to `href`. */
  onLaunch?: (href: string) => void
  /** Called when the portal session fetch fails. */
  onError?: (error: Error) => void
  /**
   * Optional className appended while a click-time fetch is in flight.
   * Only applies on the cache-miss click path — the cached path resolves
   * synchronously, so this class never lights up under steady-state use.
   */
  loadingClassName?: string
  /**
   * Optional className appended after a click-time fetch fails. Cleared
   * on the next successful click attempt.
   */
  errorClassName?: string
  /**
   * Render via `Slot` so consumers can substitute their own element
   * (typically a real `<button>`) while preserving the `href`, `target`,
   * `rel`, and click chain.
   */
  asChild?: boolean
}

export const LaunchCustomerPortalButton = forwardRef<
  HTMLAnchorElement,
  LaunchCustomerPortalButtonProps
>(function LaunchCustomerPortalButton(
  {
    children,
    onLaunch,
    onError,
    onClick,
    loadingClassName,
    errorClassName,
    asChild,
    className,
    ...rest
  },
  forwardedRef,
) {
  const { status, url, ensure } = useCustomerSessionUrl()
  const copy = useCopy()
  const handleExternalClick = useExternalLinkClick()
  const openExternal = useOpenExternal()
  const [clickState, setClickState] = useState<ClickState>('idle')

  const isReady = status === 'ready' && typeof url === 'string'
  const label = children ?? copy.customerPortal.launchButton
  const labelText = typeof label === 'string' ? label : copy.customerPortal.launchButton

  const composedClassName = [
    className,
    clickState === 'pending' ? loadingClassName : null,
    clickState === 'error' ? errorClassName : null,
  ]
    .filter(Boolean)
    .join(' ') || undefined

  // Cache-hit path: the anchor carries a real href + target, so
  // `handleExternalClick` either hands the URL to the host (sandboxed
  // frames) or lets the browser navigate (everywhere else).
  const handleReadyClick = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    if (!isReady || !url) return
    onLaunch?.(url)
    handleExternalClick(event)
  }

  // Cache-miss path: suppress the empty-href navigation, await the
  // shared in-flight promise, then open the resolved URL through the
  // same host-first opener.
  const handlePendingClick = async (event: React.MouseEvent<HTMLAnchorElement>): Promise<void> => {
    event.preventDefault()
    setClickState('pending')
    try {
      const resolved = await ensure()
      if (!(await openExternal(resolved))) {
        setClickState('error')
        onError?.(new Error(`Host declined to open the customer portal: ${resolved}`))
        return
      }
      setClickState('idle')
      onLaunch?.(resolved)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setClickState('error')
      onError?.(error)
    }
  }

  const sharedProps = {
    'data-solvapay-launch-customer-portal': '',
    'data-state': clickState === 'pending' ? 'pending' : isReady ? 'ready' : 'idle',
    'aria-label': `${labelText} (opens in a new tab)`,
    className: composedClassName,
    ...rest,
  }

  if (isReady && url) {
    const readyProps = {
      ...sharedProps,
      href: url,
      target: '_blank' as const,
      rel: 'noopener noreferrer',
      onClick: composeEventHandlers(onClick, handleReadyClick),
    }
    if (asChild) {
      return (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <Slot ref={forwardedRef as any} {...(readyProps as Record<string, unknown>)}>
          {label}
        </Slot>
      )
    }
    return (
      <a ref={forwardedRef} {...readyProps}>
        {label}
        <ExternalLinkGlyph />
      </a>
    )
  }

  const pendingProps = {
    ...sharedProps,
    role: 'link',
    onClick: composeEventHandlers(onClick, handlePendingClick),
  }
  if (asChild) {
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <Slot ref={forwardedRef as any} {...(pendingProps as Record<string, unknown>)}>
        {label}
      </Slot>
    )
  }
  return (
    <a ref={forwardedRef} {...pendingProps}>
      {label}
      <ExternalLinkGlyph />
    </a>
  )
})
