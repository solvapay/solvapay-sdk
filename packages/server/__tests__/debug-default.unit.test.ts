import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSolvaPay } from '../src'
import type { SolvaPayClient } from '../src/types'

const gateOnce = async (apiClient: Partial<SolvaPayClient>, customer: string) => {
  const solvaPay = createSolvaPay({ apiClient: apiClient as SolvaPayClient })
  const payable = solvaPay.payable({ productRef: 'prd_debug' })
  await payable.gate(
    new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'x-customer-ref': customer },
    }),
  )
}

const base: Partial<SolvaPayClient> = {
  checkLimits: async () => ({ withinLimits: true, remaining: 5, plan: 'free' }) as never,
  trackUsage: async () => undefined,
}

// A failed create is logged only in debug mode (the error is rethrown anyway).
const failingCreate: Partial<SolvaPayClient> = {
  ...base,
  getCustomer: async () => null as never,
  createCustomer: async () => {
    throw new Error('create unavailable')
  },
}

// A failed lookup is swallowed and the paywall carries on to create, so it
// must warn whatever SOLVAPAY_DEBUG says.
const failingLookup: Partial<SolvaPayClient> = {
  ...base,
  getCustomer: async () => {
    throw new Error('lookup unavailable')
  },
  createCustomer: async () => ({ customerRef: 'cus_DEBUG1' }) as never,
}

const lines = (spy: ReturnType<typeof vi.spyOn>, text: string) =>
  spy.mock.calls.filter(call => String(call[0]).includes(text))

describe('SOLVAPAY_DEBUG default on createSolvaPay', () => {
  let log: ReturnType<typeof vi.spyOn>
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.stubEnv('SOLVAPAY_AUTH_TRUST_GATEWAY', 'true')
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    log.mockRestore()
    warn.mockRestore()
  })

  it('does not log debug output when SOLVAPAY_DEBUG is unset', async () => {
    vi.stubEnv('SOLVAPAY_DEBUG', undefined)
    await expect(gateOnce(failingCreate, 'debug_unset_user')).rejects.toThrow('create unavailable')
    expect(lines(log, 'Failed to auto-create customer')).toHaveLength(0)
  })

  it('logs debug output when SOLVAPAY_DEBUG is "true"', async () => {
    vi.stubEnv('SOLVAPAY_DEBUG', 'true')
    await expect(gateOnce(failingCreate, 'debug_true_user')).rejects.toThrow('create unavailable')
    expect(lines(log, 'Failed to auto-create customer')).toHaveLength(1)
  })

  it('warns about a swallowed lookup failure with debug off', async () => {
    vi.stubEnv('SOLVAPAY_DEBUG', undefined)
    await gateOnce(failingLookup, 'debug_lookup_user')
    expect(lines(warn, 'Error looking up customer by externalRef')).toHaveLength(1)
  })
})
