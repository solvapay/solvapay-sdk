import { describe, it, expect, afterEach, vi } from 'vitest'
import type { SolvaPayClient } from '../src/types'

/**
 * The request deduplicator lazily starts a cache-cleanup `setInterval`. That
 * timer must not hold the event loop open, or any Node script, CLI or job
 * that does a single customer lookup never exits.
 */

function captureIntervals() {
  const created: Array<ReturnType<typeof setInterval>> = []
  const real = globalThis.setInterval
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((
    ...args: Parameters<typeof setInterval>
  ) => {
    const timer = real(...args)
    created.push(timer)
    return timer
  }) as typeof setInterval)
  return created
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('request deduplicator cleanup timer', () => {
  it('leaves no ref’d timer after a customer lookup', async () => {
    // Fresh modules, so the shared customer-lookup deduplicator has not
    // started its interval yet.
    vi.resetModules()
    const { createSolvaPay } = await import('../src')
    const created = captureIntervals()

    const apiClient = {
      async getCustomer() {
        return { customerRef: 'cus_u', email: 'u@example.com', externalRef: 'u', purchases: [] }
      },
      async createCustomer() {
        throw new Error('not used')
      },
    } as unknown as SolvaPayClient

    const ref = await createSolvaPay({ apiClient }).ensureCustomer('u', 'u')
    expect(ref).toBe('cus_u')

    expect(created.length).toBeGreaterThan(0)
    for (const timer of created) {
      expect((timer as NodeJS.Timeout).hasRef()).toBe(false)
      clearInterval(timer)
    }
  })

  it('works where setInterval returns a number (Cloudflare Workers)', async () => {
    const { createRequestDeduplicator } = await import('../src/utils')
    vi.spyOn(globalThis, 'setInterval').mockImplementation(
      (() => 42) as unknown as typeof setInterval,
    )

    const dedup = createRequestDeduplicator<string>({ cacheTTL: 1000 })
    await expect(dedup.deduplicate('k', async () => 'v')).resolves.toBe('v')
    expect(globalThis.setInterval).toHaveBeenCalledTimes(1)
  })
})
