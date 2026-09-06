'use client'

/**
 * MCP bridge — a thin feature-detect wrapper around the outbound host
 * methods we emit from SolvaPay views:
 *
 *   - `app.updateModelContext({ content | structuredContent })` —
 *     Phase 1: committed widget milestones (plan select, cancel /
 *     reactivate, topup confirmed, successful activation). Gives the
 *     model up-to-date context without burning a tool call or forcing
 *     a message into the chat transcript.
 *   - `app.sendMessage({ role, content })` — Phase 5: optional
 *     user-visible follow-ups after success (top-up completed, plan
 *     activated).
 *   - `app.openLink({ url })` — the only way out of the iframe on hosts
 *     whose sandbox omits `allow-popups`. Exposed to the view tree as an
 *     `<ExternalLinkProvider>` rather than a bridge method, so every
 *     anchor the SDK renders picks it up without knowing about MCP.
 *
 * Views read the bridge via `useMcpBridge()`. Outside a
 * `<McpBridgeProvider>`, all methods resolve to no-ops so the views
 * stay reusable in non-MCP embeddings.
 *
 * `<McpBridgeProvider>` is mounted internally by `<McpApp>` wrapping
 * the provider tree; integrators hand-rolling their own shell can
 * mount it themselves with the same `app` they pass to
 * `createMcpAppAdapter`.
 */

import React, { createContext, useContext, useMemo } from 'react'
import { ExternalLinkProvider, type ExternalLinkOpener } from '../hooks/useExternalLink'
import { formatPrice } from '../utils/format'
import { useHostLocale } from './useHostLocale'

/**
 * Minimal shape of `@modelcontextprotocol/ext-apps` `App` needed by
 * the bridge. Both methods are optional so older hosts (and tests)
 * don't have to stub them — we feature-detect at call time.
 */
export interface McpBridgeAppLike {
  updateModelContext?: (params: {
    content?: Array<{ type: 'text'; text: string }>
    structuredContent?: Record<string, unknown>
  }) => Promise<unknown> | void
  sendMessage?: (params: {
    role: 'user'
    content: Array<{ type: 'text'; text: string }>
  }) => Promise<unknown> | void
  /**
   * `ui/open-link` — ask the host to open a URL in the user's browser.
   * On hosts whose iframe sandbox omits `allow-popups` (Claude) this is
   * the only way out of the frame: `<a target="_blank">` and
   * `window.open()` are both dropped there without an error.
   */
  openLink?: (params: { url: string }) => Promise<{ isError?: boolean } | undefined>
  /**
   * Host capabilities resolved during `connect()`. `openLinks` gates
   * `openLink` — a host can expose the method without declaring
   * support, and calling it blind would swallow the click.
   */
  getHostCapabilities?: () => { openLinks?: unknown } | undefined
}

export interface NotifyModelContextParams {
  /** Short, plain-text update ("User selected Pro"). */
  text?: string
  /**
   * Raw structured content passthrough for richer payloads.
   * Overrides `text` if both are provided.
   */
  structuredContent?: Record<string, unknown>
}

export interface SendMessageParams {
  /** User-visible follow-up copy ("Topped up $18. Ready to keep working."). */
  text: string
}

/**
 * Success events the MCP bridge knows how to follow up in chat on.
 * Extended via the `messageOnSuccess` prop — merchants return
 * alternate copy (or `null` to suppress) per event.
 */
export type McpSuccessEvent =
  | { kind: 'topup'; amountMinor: number; currency: string }
  | { kind: 'plan-activated'; planName: string | null }

export type McpMessageOnSuccess = (evt: McpSuccessEvent) => string | null

export interface McpBridgeValue {
  /**
   * Emit `ui/update-model-context` to the host. Feature-detected —
   * resolves as a no-op on hosts that don't implement the method.
   * Errors are swallowed: a failed host update shouldn't break the
   * committed user action that triggered it.
   */
  notifyModelContext: (params: NotifyModelContextParams) => Promise<void>
  /**
   * Emit `ui/message` to the host. Feature-detected and error-safe
   * for the same reason.
   */
  sendMessage: (params: SendMessageParams) => Promise<void>
  /**
   * Phase 5 — post a user-visible follow-up after a committed success
   * (topup completed, plan activated). Resolves the copy via the
   * merchant's `messageOnSuccess` override (or a built-in default)
   * and forwards to `sendMessage`. Returning `null` from
   * `messageOnSuccess` suppresses the follow-up.
   */
  notifySuccess: (evt: McpSuccessEvent) => Promise<void>
}

const NOOP_BRIDGE: McpBridgeValue = {
  notifyModelContext: async () => {},
  sendMessage: async () => {},
  notifySuccess: async () => {},
}

const McpBridgeContext = createContext<McpBridgeValue>(NOOP_BRIDGE)

export interface McpBridgeProviderProps {
  app: McpBridgeAppLike
  /**
   * Per-event override for the Phase-5 success follow-up copy.
   * Return `null` to suppress the follow-up for that event. Defaults
   * are provided for `topup` and `plan-activated`; hosts that don't
   * support `ui/message` silently no-op via the feature-detect in
   * `sendMessage`.
   */
  messageOnSuccess?: McpMessageOnSuccess
  children: React.ReactNode
}

export function McpBridgeProvider({ app, messageOnSuccess, children }: McpBridgeProviderProps) {
  const locale = useHostLocale()
  const value = useMemo<McpBridgeValue>(() => {
    return {
      notifyModelContext: async (params: NotifyModelContextParams): Promise<void> => {
        if (typeof app.updateModelContext !== 'function') return
        const payload =
          params.structuredContent !== undefined
            ? { structuredContent: params.structuredContent }
            : params.text !== undefined
              ? { content: [{ type: 'text' as const, text: params.text }] }
              : null
        if (!payload) return
        try {
          await app.updateModelContext(payload)
        } catch {
          // Soft signal — non-compliant hosts / transient failures
          // must not abort the user-facing flow that triggered the
          // emit.
        }
      },
      sendMessage: async (params: SendMessageParams): Promise<void> => {
        if (typeof app.sendMessage !== 'function') return
        try {
          await app.sendMessage({
            role: 'user',
            content: [{ type: 'text', text: params.text }],
          })
        } catch {
          // Same rationale as above.
        }
      },
      notifySuccess: async (evt: McpSuccessEvent): Promise<void> => {
        const resolved = messageOnSuccess
          ? messageOnSuccess(evt)
          : defaultSuccessCopy(evt, locale)
        if (resolved === null || resolved === undefined) return
        if (typeof app.sendMessage !== 'function') return
        try {
          await app.sendMessage({
            role: 'user',
            content: [{ type: 'text', text: resolved }],
          })
        } catch {
          // Soft signal — same rationale as above.
        }
      },
    }
  }, [app, locale, messageOnSuccess])

  const opener = useMemo<ExternalLinkOpener>(
    () => ({
      // Capabilities are read at click time, not render time: the
      // bridge can mount before `connect()` has populated them, and a
      // render-time snapshot would go stale.
      canOpen: () =>
        typeof app.openLink === 'function' && Boolean(app.getHostCapabilities?.()?.openLinks),
      open: async (url: string): Promise<boolean> => {
        if (typeof app.openLink !== 'function') return false
        try {
          const result = await app.openLink({ url })
          // `isError` is the host's documented refusal signal (blocked
          // domain, user cancelled), not a transport failure.
          return result?.isError !== true
        } catch (err) {
          // Reported to the caller as `false` so it can surface the
          // dead end; logged here because this is the only frame that
          // still holds the cause.
          console.error('[solvapay] ui/open-link failed:', err)
          return false
        }
      },
    }),
    [app],
  )

  return (
    <McpBridgeContext.Provider value={value}>
      <ExternalLinkProvider opener={opener}>{children}</ExternalLinkProvider>
    </McpBridgeContext.Provider>
  )
}

export function useMcpBridge(): McpBridgeValue {
  return useContext(McpBridgeContext)
}

/**
 * Default follow-up copy for the Phase-5 success events. Kept plain
 * and action-complete so the model can continue the conversation
 * without re-prompting the user ("Ready to keep working." hands the
 * baton back).
 */
function defaultSuccessCopy(evt: McpSuccessEvent, locale?: string): string {
  switch (evt.kind) {
    case 'topup': {
      const amount = formatPrice(evt.amountMinor, evt.currency, { locale })
      return `Topped up ${amount}. Ready to keep working.`
    }
    case 'plan-activated':
      return `Activated ${evt.planName ?? 'plan'}.`
    default: {
      // Exhaustiveness guard — TS catches new cases; runtime returns
      // an empty string which `notifySuccess` treats as a no-op.
      const _never: never = evt
      void _never
      return ''
    }
  }
}
