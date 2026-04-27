'use client'

/**
 * `<LaunchCustomerPortalButton>` — opens the SolvaPay hosted customer
 * portal in a new browser tab.
 *
 * Render-eager: the button is enabled and labelled from the first paint
 * regardless of session state. The portal session URL is fetched in the
 * background through `useCustomerSessionUrl()` (a single in-flight call
 * shared across every instance under the same transport). When the URL
 * is ready, click is a synchronous `<a target="_blank">` navigation —
 * which MCP host sandboxes permit even though scripted `window.open`
 * after an async round-trip is blocked.
 *
 * If the user clicks before the URL has resolved, the click handler
 * awaits the in-flight fetch and falls back to `window.open` (works on
 * hosts that don't sandbox scripted opens, e.g. ChatGPT). On Claude the
 * sandbox silently drops the open in that race; the cache-hit path
 * remains the optimal one and is the steady state for any user that
 * doesn't click within a few hundred ms of opening the surface.
 */

import React, { forwardRef, useState } from 'react'
import { useCustomerSessionUrl } from '../hooks/useCustomerSessionUrl'
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

  // Synchronous, sandbox-safe path: anchor has a real href + target,
  // browser handles the navigation, we just notify onLaunch.
  const handleReadyClick = (): void => {
    if (!isReady || !url) return
    onLaunch?.(url)
  }

  // Cache-miss path: prevent the empty-href navigation, await the
  // shared in-flight promise, then window.open. Claude's sandbox blocks
  // post-await opens; ChatGPT permits them.
  const handlePendingClick = async (event: React.MouseEvent<HTMLAnchorElement>): Promise<void> => {
    event.preventDefault()
    setClickState('pending')
    try {
      const resolved = await ensure()
      setClickState('idle')
      if (typeof window !== 'undefined') {
        window.open(resolved, '_blank', 'noopener,noreferrer')
      }
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
