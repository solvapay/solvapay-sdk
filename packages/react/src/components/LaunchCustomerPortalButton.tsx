'use client'

/**
 * `<LaunchCustomerPortalButton>` — opens the SolvaPay hosted customer
 * portal in a new browser tab.
 *
 * Works identically in HTTP and MCP contexts because it routes through
 * `transport.createCustomerSession()` (either HTTP `/api/create-customer-session`
 * or MCP `create_customer_session` tool). The portal URL is pre-fetched on
 * mount so the click handler can navigate via a real `<a target="_blank">`,
 * which MCP host sandboxes permit (scripted `window.open` after an async
 * round-trip is blocked — see `mcp-checkout-app` for prior art).
 */

import React, { forwardRef, useEffect, useRef, useState } from 'react'
import { useTransport } from '../hooks/useTransport'
import { useCopy } from '../hooks/useCopy'
import { composeEventHandlers } from '../primitives/composeEventHandlers'
import { Slot } from '../primitives/slot'

type UrlState =
  | { status: 'loading' }
  | { status: 'ready'; href: string }
  | { status: 'error'; message: string }

export interface LaunchCustomerPortalButtonProps
  extends Omit<
    React.AnchorHTMLAttributes<HTMLAnchorElement>,
    'href' | 'target' | 'rel' | 'onError'
  > {
  /** Override the default "Manage billing" label. */
  children?: React.ReactNode
  /** Called immediately before the user navigates to `href`. */
  onLaunch?: (href: string) => void
  /** Called when the portal session fetch fails. */
  onError?: (error: Error) => void
  /** Optional className applied to the disabled <button> shown while loading. */
  loadingClassName?: string
  /** Optional className applied to the disabled <button> shown on error. */
  errorClassName?: string
  /**
   * Render the ready-state anchor via `Slot` so consumers can substitute
   * their own element (typically a real `<button>`) while preserving the
   * `href`, `target`, `rel`, and click chain. The loading/error fallback
   * buttons are untouched — `asChild` only swaps the ready-state shell.
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
    ...rest
  },
  forwardedRef,
) {
  const transport = useTransport()
  const copy = useCopy()
  const [state, setState] = useState<UrlState>({ status: 'loading' })

  // Capture onError in a ref so parents passing an inline arrow don't
  // re-fire the pre-fetch effect on every render.
  const onErrorRef = useRef(onError)
  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    let cancelled = false
    transport
      .createCustomerSession()
      .then(({ customerUrl }) => {
        if (cancelled) return
        setState({ status: 'ready', href: customerUrl })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const error = err instanceof Error ? err : new Error(String(err))
        setState({ status: 'error', message: error.message })
        onErrorRef.current?.(error)
      })
    return () => {
      cancelled = true
    }
  }, [transport])

  if (state.status === 'ready') {
    const label = children ?? copy.customerPortal.launchButton
    const labelText = typeof label === 'string' ? label : copy.customerPortal.launchButton
    const readyProps = {
      href: state.href,
      target: '_blank' as const,
      rel: 'noopener noreferrer',
      'data-solvapay-launch-customer-portal': '',
      'data-state': 'ready' as const,
      'aria-label': `${labelText} (opens in a new tab)`,
      onClick: composeEventHandlers(onClick, () => {
        onLaunch?.(state.href)
      }),
      ...rest,
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
        <span className="solvapay-mcp-external-glyph" aria-hidden="true">
          {' '}↗
        </span>
      </a>
    )
  }

  if (state.status === 'error') {
    return (
      <button
        type="button"
        className={errorClassName}
        data-solvapay-launch-customer-portal=""
        data-state="error"
        aria-disabled
        disabled
      >
        {children ?? copy.customerPortal.launchButton}
      </button>
    )
  }

  // loading
  return (
    <button
      type="button"
      className={loadingClassName}
      data-solvapay-launch-customer-portal=""
      data-state="loading"
      aria-busy
      aria-disabled
      disabled
    >
      {copy.customerPortal.loadingLabel}
    </button>
  )
})
