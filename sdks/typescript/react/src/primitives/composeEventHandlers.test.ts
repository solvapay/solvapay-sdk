import { describe, it, expect, vi } from 'vitest'
import { composeEventHandlers } from './composeEventHandlers'

function makeEvent(overrides: Partial<{ defaultPrevented: boolean }> = {}) {
  const state = { defaultPrevented: overrides.defaultPrevented ?? false }
  return {
    get defaultPrevented() {
      return state.defaultPrevented
    },
    preventDefault() {
      state.defaultPrevented = true
    },
  } as unknown as React.SyntheticEvent
}

describe('composeEventHandlers', () => {
  it('calls the consumer handler first, then the internal handler', () => {
    const order: string[] = []
    const consumer = vi.fn(() => order.push('consumer'))
    const internal = vi.fn(() => order.push('internal'))
    const handler = composeEventHandlers(consumer, internal)

    handler(makeEvent())

    expect(order).toEqual(['consumer', 'internal'])
    expect(consumer).toHaveBeenCalledOnce()
    expect(internal).toHaveBeenCalledOnce()
  })

  it('skips the internal handler when the consumer calls preventDefault', () => {
    const consumer = vi.fn((e: React.SyntheticEvent) => e.preventDefault())
    const internal = vi.fn()
    const handler = composeEventHandlers(consumer, internal)

    handler(makeEvent())

    expect(consumer).toHaveBeenCalledOnce()
    expect(internal).not.toHaveBeenCalled()
  })

  it('allows overriding with checkForDefaultPrevented=false', () => {
    const consumer = vi.fn((e: React.SyntheticEvent) => e.preventDefault())
    const internal = vi.fn()
    const handler = composeEventHandlers(consumer, internal, {
      checkForDefaultPrevented: false,
    })

    handler(makeEvent())

    expect(internal).toHaveBeenCalledOnce()
  })

  it('runs the internal handler when there is no consumer', () => {
    const internal = vi.fn()
    const handler = composeEventHandlers<React.SyntheticEvent>(undefined, internal)

    handler(makeEvent())

    expect(internal).toHaveBeenCalledOnce()
  })

  it('runs the consumer when there is no internal handler', () => {
    const consumer = vi.fn()
    const handler = composeEventHandlers(consumer, undefined)

    handler(makeEvent())

    expect(consumer).toHaveBeenCalledOnce()
  })
})
