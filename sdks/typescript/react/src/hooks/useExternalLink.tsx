'use client'

/**
 * External-link routing — the one place the SDK leaves its own frame.
 *
 * MCP hosts render app views inside a sandboxed iframe. Claude's sandbox
 * omits `allow-popups`, so `<a target="_blank">` and `window.open()` are
 * both dropped silently: the user clicks, nothing happens, and the only
 * trace is a line in the iframe's own console. The MCP Apps answer is
 * `ui/open-link` — the host opens the URL on the view's behalf.
 *
 * `<ExternalLinkProvider>` supplies that host-mediated opener, and
 * `<McpBridgeProvider>` mounts one automatically from `app.openLink`.
 * With no provider in scope (plain web checkout, MCP Inspector, hosts
 * that do allow popups) there is no opener and anchors navigate
 * natively — non-MCP surfaces behave exactly as they did before.
 *
 * Components never branch on the host themselves. They render a real
 * `href` + `target="_blank"` and pass `useExternalLinkClick()` as
 * `onClick`. Keeping the `href` real preserves the link role, "copy
 * link address", and middle-click wherever the sandbox permits them.
 */

import React, { createContext, useCallback, useContext } from 'react'

export interface ExternalLinkOpener {
  /**
   * Whether the host can open links right now. Read synchronously from
   * the click handler, because suppressing native navigation on a host
   * that *cannot* open links would turn a working link into a dead one
   * — so `preventDefault()` is gated on this returning `true`.
   */
  canOpen: () => boolean
  /**
   * Hand `url` to the host. Resolves `false` when the host refused
   * (blocked domain, user cancelled) or the request failed, so callers
   * can surface the dead end instead of leaving the user guessing.
   */
  open: (url: string) => Promise<boolean>
}

const ExternalLinkContext = createContext<ExternalLinkOpener | null>(null)

export interface ExternalLinkProviderProps {
  opener: ExternalLinkOpener
  children: React.ReactNode
}

export function ExternalLinkProvider({ opener, children }: ExternalLinkProviderProps) {
  return <ExternalLinkContext.Provider value={opener}>{children}</ExternalLinkContext.Provider>
}

/**
 * Imperative opener for flows that only learn the URL after an `await`,
 * where there is no anchor left to click (the portal button's
 * cache-miss path). Prefers the host, otherwise asks the browser.
 *
 * Resolves `false` only when a host-mediated open was attempted and
 * refused. The browser path reports `true` because it cannot be
 * verified: `window.open` with `noopener` returns `null` on success by
 * spec, so a null handle says nothing about whether the tab opened.
 */
export function useOpenExternal(): (url: string) => Promise<boolean> {
  const opener = useContext(ExternalLinkContext)
  return useCallback(
    async (url: string): Promise<boolean> => {
      if (opener?.canOpen()) return opener.open(url)
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
      return true
    },
    [opener],
  )
}

/**
 * `onClick` for any `<a href target="_blank">` the SDK renders. A no-op
 * when no host opener is mounted, which leaves the browser to navigate.
 */
export function useExternalLinkClick(): (event: React.MouseEvent<HTMLAnchorElement>) => void {
  const opener = useContext(ExternalLinkContext)
  return useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>): void => {
      if (event.defaultPrevented) return
      if (!opener?.canOpen()) return
      // Read `currentTarget.href` before `preventDefault` so an
      // `asChild` consumer rendering a non-anchor (no resolved `href`)
      // falls through to its own behaviour untouched.
      const href = event.currentTarget.href
      if (!href) return
      event.preventDefault()
      void opener.open(href).then(opened => {
        if (!opened) {
          console.warn(`[solvapay] host declined to open ${href}`)
        }
      })
    },
    [opener],
  )
}
