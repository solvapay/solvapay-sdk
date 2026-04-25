/**
 * Phase 4 — `useMcpToolResult` escape hatch.
 *
 * Mirror of Phase 3's subscription, surfaced as a public hook for
 * integrators who bypass `<McpApp>` / `<McpAppShell>` to build custom
 * widgets. Returns the latest `ui/notifications/tool-result` payload
 * plus the current host-reported tool name.
 */

import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { useMcpToolResult } from './useMcpToolResult'

type ToolResultHandler = (params: unknown) => void

function makeApp(initialToolName?: string) {
  const listeners: Record<string, ToolResultHandler[]> = {}
  const hostContext = initialToolName
    ? { toolInfo: { tool: { name: initialToolName } } }
    : undefined
  const app = {
    getHostContext: () => hostContext,
    addEventListener: vi.fn((evt: string, handler: ToolResultHandler) => {
      ;(listeners[evt] ??= []).push(handler)
    }),
    removeEventListener: vi.fn((evt: string, handler: ToolResultHandler) => {
      const bucket = listeners[evt] ?? []
      const idx = bucket.indexOf(handler)
      if (idx >= 0) bucket.splice(idx, 1)
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  const fire = (params: unknown) => {
    for (const h of listeners['toolresult'] ?? []) h(params)
  }
  return { app, fire, hostContext }
}

function Probe<T>({ app, onRender }: { app: unknown; onRender: (r: unknown) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = useMcpToolResult<T>(app as any)
  onRender(result)
  return <div data-testid="probe" />
}

describe('useMcpToolResult', () => {
  it('returns a null-shaped baseline before any notification arrives', () => {
    const { app } = makeApp('upgrade')
    const onRender = vi.fn()
    render(<Probe app={app} onRender={onRender} />)
    const latest = onRender.mock.calls[onRender.mock.calls.length - 1][0] as {
      structuredContent: unknown
      content: unknown[]
      toolName: string | null
    }
    expect(latest.structuredContent).toBeNull()
    expect(latest.content).toEqual([])
    expect(latest.toolName).toBe('upgrade')
  })

  it('updates on a subsequent toolresult notification', () => {
    const { app, fire } = makeApp('manage_account')
    const onRender = vi.fn()
    render(<Probe<{ foo: string }> app={app} onRender={onRender} />)

    act(() => {
      fire({
        structuredContent: { foo: 'bar' },
        content: [{ type: 'text', text: 'ok' }],
      })
    })

    const latest = onRender.mock.calls[onRender.mock.calls.length - 1][0] as {
      structuredContent: { foo: string } | null
      content: Array<{ type: string; text?: string }>
      toolName: string | null
    }
    expect(latest.structuredContent).toEqual({ foo: 'bar' })
    expect(latest.content).toEqual([{ type: 'text', text: 'ok' }])
    expect(latest.toolName).toBe('manage_account')
  })

  it('ignores error notifications', () => {
    const { app, fire } = makeApp('upgrade')
    const onRender = vi.fn()
    render(<Probe app={app} onRender={onRender} />)

    act(() => {
      fire({
        isError: true,
        content: [{ type: 'text', text: 'oops' }],
      })
    })

    const latest = onRender.mock.calls[onRender.mock.calls.length - 1][0] as {
      structuredContent: unknown
    }
    expect(latest.structuredContent).toBeNull()
  })

  it('unsubscribes on unmount', () => {
    const { app } = makeApp('topup')
    const { unmount } = render(<Probe app={app} onRender={() => {}} />)
    expect(app.addEventListener).toHaveBeenCalledWith('toolresult', expect.any(Function))
    unmount()
    expect(app.removeEventListener).toHaveBeenCalledWith('toolresult', expect.any(Function))
  })

  it('falls back to `ontoolresult` setter when addEventListener is absent', () => {
    let onToolResult: ToolResultHandler | undefined
    const hostContext = { toolInfo: { tool: { name: 'upgrade' } } }
    const app = {
      getHostContext: () => hostContext,
      get ontoolresult() {
        return onToolResult
      },
      set ontoolresult(h: ToolResultHandler | undefined) {
        onToolResult = h
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const onRender = vi.fn()
    render(<Probe<{ x: number }> app={app} onRender={onRender} />)
    act(() => {
      onToolResult?.({
        structuredContent: { x: 1 },
        content: [],
      })
    })
    const latest = onRender.mock.calls[onRender.mock.calls.length - 1][0] as {
      structuredContent: { x: number } | null
    }
    expect(latest.structuredContent).toEqual({ x: 1 })
  })

  it('renders a <probe> synchronously without crashing', () => {
    const { app } = makeApp('upgrade')
    render(<Probe app={app} onRender={() => {}} />)
    expect(screen.getByTestId('probe')).toBeTruthy()
  })
})
