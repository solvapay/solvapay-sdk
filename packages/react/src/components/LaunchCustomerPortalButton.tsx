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

import React, { forwardRef, useEffect, useState } from 'react'
import { useTransport } from '../hooks/useTransport'
import { useCopy } from '../hooks/useCopy'
import { composeEventHandlers } from '../primitives/composeEventHandlers'

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
}

export const LaunchCustomerPortalButton = forwardRef<
  HTMLAnchorElement,
  LaunchCustomerPortalButtonProps
>(function LaunchCustomerPortalButton(
  { children, onLaunch, onError, onClick, loadingClassName, errorClassName, ...rest },
  forwardedRef,
) {
  const transport = useTransport()
  const copy = useCopy()
  const [state, setState] = useState<UrlState>({ status: 'loading' })

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
        onError?.(error)
      })
    return () => {
      cancelled = true
    }
  }, [transport, onError])

  if (state.status === 'ready') {
    return (
      <a
        ref={forwardedRef}
        href={state.href}
        target="_blank"
        rel="noopener noreferrer"
        data-solvapay-launch-customer-portal=""
        data-state="ready"
        onClick={composeEventHandlers(onClick, () => {
          onLaunch?.(state.href)
        })}
        {...rest}
      >
        {children ?? copy.customerPortal.launchButton}
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
