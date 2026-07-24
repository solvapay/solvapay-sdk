import { describe, it, expect, vi } from 'vitest'
import { createSolvaPay } from '../src'

/**
 * `assignCredits` / `trackUsageBulk` wire shapes are Rust-only (napi / WASM)
 * and covered by `client-native-dispatch.unit.test.ts`, the Group A/C dispatch
 * suites, and the `client/*` contract fixtures. This suite only asserts the
 * higher-level `createSolvaPay` facade delegates to the injected API client.
 */
describe('credits and usage SDK delegation', () => {
  it('createSolvaPay exposes assignCredits and trackUsageBulk by delegating to the API client', async () => {
    const assignCredits = vi.fn().mockResolvedValue({
      success: true,
      customerRef: 'cus_123',
      credits: 25000,
      balance: 50000,
    })
    const trackUsageBulk = vi.fn().mockResolvedValue({
      success: true,
      inserted: 1,
      results: [{ reference: 'usage_1' }],
    })

    const sdk = createSolvaPay({
      apiClient: {
        checkLimits: vi.fn(),
        trackUsage: vi.fn(),
        assignCredits,
        trackUsageBulk,
      },
    })

    await sdk.assignCredits({ customerRef: 'cus_123', credits: 25000 })
    await sdk.trackUsageBulk({ events: [{ customerRef: 'cus_123', units: 1 }] })

    expect(assignCredits).toHaveBeenCalledWith({ customerRef: 'cus_123', credits: 25000 })
    expect(trackUsageBulk).toHaveBeenCalledWith({
      events: [{ customerRef: 'cus_123', units: 1 }],
    })
  })
})
