'use client'

/**
 * Host-info context for MCP apps.
 *
 * Exposes the host's `Implementation.name` (as reported by
 * `@modelcontextprotocol/ext-apps` `App.getHostVersion()`) to child
 * components via `useHostName()`. The primary consumer is
 * `<AppHeader>`, which uses the host name to decide whether to render
 * an in-widget merchant mark: ChatGPT prohibits in-widget logos and
 * Claude Desktop paints its own MCP app chrome strip above every
 * widget, so both suppress the in-widget row; MCP Jam, VS Code, and
 * most other hosts leave branding to the app.
 *
 * `<McpApp>` mounts `<McpHostInfoProvider>` at the top of its tree
 * with the freshly-connected host name, so every render path —
 * including the pre-bootstrap loading / error cards — has access.
 *
 * Outside `<McpHostInfoProvider>` (custom shells, tests), the hook
 * returns `null`; callers treat that as "host unknown" and fall back
 * to rendering the default mark.
 */

import React, { createContext, useContext } from 'react'

const McpHostInfoContext = createContext<string | null>(null)

export interface McpHostInfoProviderProps {
  /**
   * Host implementation name, e.g. `'ChatGPT'`, `'Claude Desktop'`,
   * `'MCP Jam'`. Pass `null` before `app.connect()` resolves; the
   * provider treats null as "unknown" and downstream hooks return
   * null.
   */
  hostName: string | null
  children: React.ReactNode
}

export function McpHostInfoProvider({ hostName, children }: McpHostInfoProviderProps) {
  return <McpHostInfoContext.Provider value={hostName}>{children}</McpHostInfoContext.Provider>
}

/**
 * Returns the current MCP host's implementation name, or `null` when
 * unknown (outside a provider, or before `app.connect()` resolves).
 *
 * Never throws — safe to call outside `<McpHostInfoProvider>`.
 */
export function useHostName(): string | null {
  return useContext(McpHostInfoContext)
}
