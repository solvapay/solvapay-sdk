/**
 * Tests for the MCP bridge — a thin feature-detect wrapper around
 * `app.updateModelContext(...)` (Phase 1) and `app.sendMessage(...)`
 * (Phase 5 groundwork).
 *
 * The bridge lives at `packages/react/src/mcp/bridge.tsx` and exposes:
 *   - `<McpBridgeProvider app={app} />`
 *   - `useMcpBridge()` → `{ notifyModelContext, sendMessage }`
 *
 * Views call the bridge without importing the `App` instance directly,
 * which keeps the per-view primitives usable in non-MCP embeddings.
 */

import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { McpBridgeProvider, useMcpBridge } from '../bridge'

function Probe() {
  const { notifyModelContext, sendMessage } = useMcpBridge()
  return (
    <>
      <button
        type="button"
        data-testid="notify"
        onClick={() => void notifyModelContext({ text: 'hello' })}
      >
        notify
      </button>
      <button
        type="button"
        data-testid="message"
        onClick={() => void sendMessage({ text: 'follow-up' })}
      >
        message
      </button>
    </>
  )
}

describe('useMcpBridge', () => {
  it('defaults to a no-op outside <McpBridgeProvider>', () => {
    render(<Probe />)
    act(() => {
      screen.getByTestId('notify').click()
      screen.getByTestId('message').click()
    })
    // If we got here without throwing, the no-op default works.
    expect(true).toBe(true)
  })

  it('wraps app.updateModelContext with the text shorthand', async () => {
    const updateModelContext = vi.fn().mockResolvedValue(undefined)
    const app = { updateModelContext }
    render(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <McpBridgeProvider app={app as any}>
        <Probe />
      </McpBridgeProvider>,
    )
    await act(async () => {
      screen.getByTestId('notify').click()
    })
    expect(updateModelContext).toHaveBeenCalledWith({
      content: [{ type: 'text', text: 'hello' }],
    })
  })

  it('supports passing structured content directly', async () => {
    const updateModelContext = vi.fn().mockResolvedValue(undefined)
    const app = { updateModelContext }
    const { result } = renderBridge(app)
    await act(async () => {
      await result.current.notifyModelContext({
        structuredContent: { plan: 'pro' },
      })
    })
    expect(updateModelContext).toHaveBeenCalledWith({
      structuredContent: { plan: 'pro' },
    })
  })

  it('silently swallows errors when the host rejects updateModelContext', async () => {
    const updateModelContext = vi.fn().mockRejectedValue(new Error('denied'))
    const app = { updateModelContext }
    const { result } = renderBridge(app)
    // Must not throw.
    await expect(result.current.notifyModelContext({ text: 'x' })).resolves.toBeUndefined()
    expect(updateModelContext).toHaveBeenCalled()
  })

  it('feature-detects missing updateModelContext and no-ops', async () => {
    const app = {} // older host, no method
    const { result } = renderBridge(app)
    await expect(result.current.notifyModelContext({ text: 'x' })).resolves.toBeUndefined()
  })

  it('wraps app.sendMessage with the text shorthand', async () => {
    const sendMessage = vi.fn().mockResolvedValue({})
    const app = { sendMessage }
    const { result } = renderBridge(app)
    await act(async () => {
      await result.current.sendMessage({ text: 'done!' })
    })
    expect(sendMessage).toHaveBeenCalledWith({
      role: 'user',
      content: [{ type: 'text', text: 'done!' }],
    })
  })

  it('feature-detects missing sendMessage and no-ops', async () => {
    const app = {}
    const { result } = renderBridge(app)
    await expect(result.current.sendMessage({ text: 'x' })).resolves.toBeUndefined()
  })
})

// ------------------------------------------------------------------
// Phase 5 — `notifySuccess` helper on top of `sendMessage`.
// ------------------------------------------------------------------

describe('useMcpBridge.notifySuccess', () => {
  it('posts the default topup copy', async () => {
    const sendMessage = vi.fn().mockResolvedValue({})
    const app = { sendMessage }
    const { result } = renderBridge(app)
    await act(async () => {
      await result.current.notifySuccess({
        kind: 'topup',
        amountMinor: 1800,
        currency: 'usd',
      })
    })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    const text = sendMessage.mock.calls[0][0].content[0].text
    expect(text).toMatch(/[Tt]opped up/)
    expect(text).toMatch(/\$18/)
    expect(text).toMatch(/Ready to keep working/)
  })

  it('posts the default plan-activation copy', async () => {
    const sendMessage = vi.fn().mockResolvedValue({})
    const app = { sendMessage }
    const { result } = renderBridge(app)
    await act(async () => {
      await result.current.notifySuccess({
        kind: 'plan-activated',
        planName: 'Pro',
      })
    })
    const text = sendMessage.mock.calls[0][0].content[0].text
    expect(text).toMatch(/Activated Pro/)
  })

  it('honours the merchant-provided messageOnSuccess override', async () => {
    const sendMessage = vi.fn().mockResolvedValue({})
    const app = { sendMessage }
    const messageOnSuccess = vi.fn((evt: { kind: string }) => `custom: ${evt.kind}`)
    const { result } = renderBridgeWith(app, messageOnSuccess)
    await act(async () => {
      await result.current.notifySuccess({
        kind: 'plan-activated',
        planName: 'Pro',
      })
    })
    const text = sendMessage.mock.calls[0][0].content[0].text
    expect(text).toBe('custom: plan-activated')
    expect(messageOnSuccess).toHaveBeenCalledWith({
      kind: 'plan-activated',
      planName: 'Pro',
    })
  })

  it('suppresses the message when messageOnSuccess returns null', async () => {
    const sendMessage = vi.fn().mockResolvedValue({})
    const app = { sendMessage }
    const { result } = renderBridgeWith(app, () => null)
    await act(async () => {
      await result.current.notifySuccess({
        kind: 'topup',
        amountMinor: 500,
        currency: 'usd',
      })
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })
})

function renderBridgeWith(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messageOnSuccess: (evt: any) => string | null,
): { result: { current: BridgeValue } } {
  const result: { current: BridgeValue } = { current: null as unknown as BridgeValue }
  const Capture = () => {
    const bridge = useMcpBridge()
    result.current = bridge
    return null
  }
  render(
    <McpBridgeProvider app={app} messageOnSuccess={messageOnSuccess}>
      <Capture />
    </McpBridgeProvider>,
  )
  return { result }
}

// ------------------------------------------------------------------
// Small helper — spin up the provider and expose `result.current`
// without react-testing-library's `renderHook` since we want the
// Probe DOM too.
// ------------------------------------------------------------------

type BridgeValue = ReturnType<typeof useMcpBridge>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderBridge(app: any): { result: { current: BridgeValue } } {
  const result: { current: BridgeValue } = { current: null as unknown as BridgeValue }
  const Capture = () => {
    const bridge = useMcpBridge()
    result.current = bridge
    return null
  }
  render(
    <McpBridgeProvider app={app}>
      <Capture />
    </McpBridgeProvider>,
  )
  return { result }
}
