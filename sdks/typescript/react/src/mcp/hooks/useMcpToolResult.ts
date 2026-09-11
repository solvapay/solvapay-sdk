'use client'

/**
 * `useMcpToolResult<T>(app)` — read the latest
 * `ui/notifications/tool-result` as plain state.
 *
 * Thin escape hatch for integrators who don't mount `<McpApp>` /
 * `<McpAppShell>` and want the raw `structuredContent` the host sends
 * back on every tool call. Mirrors the subscription `<McpApp>` uses
 * internally (Phase 3), but exposed as a hook so consumers can build
 * fully custom widgets on top of `createMcpAppAdapter`.
 *
 * Contract:
 *   - subscribes via `app.addEventListener('toolresult', …)` when
 *     available, falling back to the legacy DOM-style `ontoolresult`
 *     setter;
 *   - reads the current tool name from
 *     `app.getHostContext()?.toolInfo?.tool?.name` (mirroring Phase 3's
 *     re-routing heuristic);
 *   - uses `useSyncExternalStore` for correctness under concurrent
 *     rendering;
 *   - ignores error notifications (consumers render their own error
 *     UI from the adapter promise).
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

interface ToolResultParams {
  isError?: boolean
  content?: unknown
  structuredContent?: unknown
  _meta?: unknown
}

interface AppWithToolResult {
  getHostContext?: () => { toolInfo?: { tool?: { name?: string } } } | undefined
  addEventListener?: (evt: string, handler: (params: ToolResultParams) => void) => void
  removeEventListener?: (evt: string, handler: (params: ToolResultParams) => void) => void
  ontoolresult?: ((params: ToolResultParams) => void) | undefined
}

export interface McpToolResult<T> {
  structuredContent: T | null
  content: Array<{ type: string; text?: string }>
  toolName: string | null
}

interface Snapshot<T> {
  structuredContent: T | null
  content: Array<{ type: string; text?: string }>
  toolName: string | null
}

const EMPTY_CONTENT: Array<{ type: string; text?: string }> = []

export function useMcpToolResult<T = unknown>(app: AppWithToolResult): McpToolResult<T> {
  // Mutable ref holds the current snapshot; React's
  // `useSyncExternalStore` reads it via `getSnapshot`.
  const snapshotRef = useRef<Snapshot<T>>({
    structuredContent: null,
    content: EMPTY_CONTENT,
    toolName: app.getHostContext?.()?.toolInfo?.tool?.name ?? null,
  })

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handler = (params: ToolResultParams) => {
        if (params?.isError) return
        const toolName = app.getHostContext?.()?.toolInfo?.tool?.name ?? null
        const content = Array.isArray(params?.content)
          ? (params.content as Array<{ type: string; text?: string }>)
          : EMPTY_CONTENT
        const structuredContent = (params?.structuredContent as T | undefined) ?? null
        snapshotRef.current = { structuredContent, content, toolName }
        onStoreChange()
      }

      if (typeof app.addEventListener === 'function') {
        app.addEventListener('toolresult', handler)
        return () => app.removeEventListener?.('toolresult', handler)
      }
      const prior = app.ontoolresult
      app.ontoolresult = handler
      return () => {
        if (app.ontoolresult === handler) app.ontoolresult = prior
      }
    },
    [app],
  )

  // Refresh `toolName` when the host context changes mid-session. We
  // read it on every render via the snapshot; the effect below syncs
  // the ref so a context change notifies subscribers even before a
  // new tool-result notification lands.
  useEffect(() => {
    const current = app.getHostContext?.()?.toolInfo?.tool?.name ?? null
    if (current !== snapshotRef.current.toolName) {
      snapshotRef.current = { ...snapshotRef.current, toolName: current }
    }
  })

  return useSyncExternalStore(
    subscribe,
    () => snapshotRef.current,
    () => snapshotRef.current,
  )
}
