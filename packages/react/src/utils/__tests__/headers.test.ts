import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getAuthAdapter,
  getCachedCustomerRef,
  setCachedCustomerRef,
  clearCachedCustomerRef,
  buildRequestHeaders,
} from '../headers'
import { defaultAuthAdapter } from '../../adapters/auth'
import type { SolvaPayConfig } from '../../types'
import type { AuthAdapter } from '../../adapters/auth'

const REF_KEY = 'solvapay_customerRef'
const EXPIRY_KEY = 'solvapay_customerRef_expiry'
const USER_ID_KEY = 'solvapay_customerRef_userId'

beforeEach(() => {
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// getAuthAdapter
// ---------------------------------------------------------------------------
describe('getAuthAdapter', () => {
  it('returns the provided adapter when config.auth.adapter is set', () => {
    const adapter: AuthAdapter = {
      getToken: vi.fn(),
      getUserId: vi.fn(),
    }
    const result = getAuthAdapter({ auth: { adapter } })
    expect(result).toBe(adapter)
  })

  it('wraps deprecated getToken/getUserId functions', async () => {
    const config: SolvaPayConfig = {
      auth: {
        getToken: () => Promise.resolve('legacy-token'),
        getUserId: () => Promise.resolve('legacy-user'),
      },
    }
    const adapter = getAuthAdapter(config)
    expect(await adapter.getToken()).toBe('legacy-token')
    expect(await adapter.getUserId()).toBe('legacy-user')
  })

  it('returns defaultAuthAdapter when no auth config', () => {
    expect(getAuthAdapter(undefined)).toBe(defaultAuthAdapter)
    expect(getAuthAdapter({})).toBe(defaultAuthAdapter)
  })
})

// ---------------------------------------------------------------------------
// getCachedCustomerRef
// ---------------------------------------------------------------------------
describe('getCachedCustomerRef', () => {
  it('returns null when nothing is cached', () => {
    expect(getCachedCustomerRef()).toBeNull()
  })

  it('returns null when cache is expired and clears localStorage', () => {
    localStorage.setItem(REF_KEY, 'cus_old')
    localStorage.setItem(EXPIRY_KEY, String(Date.now() - 1000))
    localStorage.setItem(USER_ID_KEY, 'user-1')

    expect(getCachedCustomerRef()).toBeNull()
    expect(localStorage.getItem(REF_KEY)).toBeNull()
    expect(localStorage.getItem(EXPIRY_KEY)).toBeNull()
    expect(localStorage.getItem(USER_ID_KEY)).toBeNull()
  })

  it('returns cached value when valid and no userId filter', () => {
    localStorage.setItem(REF_KEY, 'cus_valid')
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + 86400000))
    localStorage.setItem(USER_ID_KEY, 'user-1')

    expect(getCachedCustomerRef()).toBe('cus_valid')
  })

  it('returns cached value when userId matches', () => {
    localStorage.setItem(REF_KEY, 'cus_match')
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + 86400000))
    localStorage.setItem(USER_ID_KEY, 'user-1')

    expect(getCachedCustomerRef('user-1')).toBe('cus_match')
  })

  it('returns null and clears cache when userId does not match', () => {
    localStorage.setItem(REF_KEY, 'cus_wrong')
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + 86400000))
    localStorage.setItem(USER_ID_KEY, 'user-1')

    expect(getCachedCustomerRef('user-2')).toBeNull()
    expect(localStorage.getItem(REF_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// setCachedCustomerRef
// ---------------------------------------------------------------------------
describe('setCachedCustomerRef', () => {
  it('stores customerRef, expiry, and userId in localStorage', () => {
    setCachedCustomerRef('cus_new', 'user-42')

    expect(localStorage.getItem(REF_KEY)).toBe('cus_new')
    expect(localStorage.getItem(USER_ID_KEY)).toBe('user-42')
    expect(Number(localStorage.getItem(EXPIRY_KEY))).toBeGreaterThan(Date.now())
  })

  it('does not cache when userId is null', () => {
    setCachedCustomerRef('cus_skip', null)
    expect(localStorage.getItem(REF_KEY)).toBeNull()
  })

  it('does not cache when userId is undefined', () => {
    setCachedCustomerRef('cus_skip', undefined)
    expect(localStorage.getItem(REF_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// clearCachedCustomerRef
// ---------------------------------------------------------------------------
describe('clearCachedCustomerRef', () => {
  it('removes all three localStorage keys', () => {
    localStorage.setItem(REF_KEY, 'cus_clear')
    localStorage.setItem(EXPIRY_KEY, '999999999999999')
    localStorage.setItem(USER_ID_KEY, 'user-1')

    clearCachedCustomerRef()

    expect(localStorage.getItem(REF_KEY)).toBeNull()
    expect(localStorage.getItem(EXPIRY_KEY)).toBeNull()
    expect(localStorage.getItem(USER_ID_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// buildRequestHeaders
// ---------------------------------------------------------------------------
describe('buildRequestHeaders', () => {
  it('always includes Content-Type: application/json', async () => {
    const { headers } = await buildRequestHeaders(undefined)
    expect((headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('adds Authorization header when adapter returns a token', async () => {
    const config: SolvaPayConfig = {
      auth: {
        adapter: {
          getToken: () => Promise.resolve('my-token'),
          getUserId: () => Promise.resolve('uid-1'),
        },
      },
    }
    const { headers } = await buildRequestHeaders(config)
    expect((headers as Record<string, string>)['Authorization']).toBe('Bearer my-token')
  })

  it('omits Authorization header when no token', async () => {
    const config: SolvaPayConfig = {
      auth: {
        adapter: {
          getToken: () => Promise.resolve(null),
          getUserId: () => Promise.resolve(null),
        },
      },
    }
    const { headers } = await buildRequestHeaders(config)
    expect((headers as Record<string, string>)['Authorization']).toBeUndefined()
  })

  it('adds x-solvapay-customer-ref when cached ref exists', async () => {
    localStorage.setItem(REF_KEY, 'cus_cached')
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + 86400000))
    localStorage.setItem(USER_ID_KEY, 'uid-1')

    const config: SolvaPayConfig = {
      auth: {
        adapter: {
          getToken: () => Promise.resolve('tok'),
          getUserId: () => Promise.resolve('uid-1'),
        },
      },
    }
    const { headers } = await buildRequestHeaders(config)
    expect((headers as Record<string, string>)['x-solvapay-customer-ref']).toBe('cus_cached')
  })

  it('merges static custom headers from config.headers object', async () => {
    const config: SolvaPayConfig = {
      auth: {
        adapter: {
          getToken: () => Promise.resolve(null),
          getUserId: () => Promise.resolve(null),
        },
      },
      headers: { 'X-Custom': 'static-value' },
    }
    const { headers } = await buildRequestHeaders(config)
    expect((headers as Record<string, string>)['X-Custom']).toBe('static-value')
  })

  it('merges async custom headers from config.headers function', async () => {
    const config: SolvaPayConfig = {
      auth: {
        adapter: {
          getToken: () => Promise.resolve(null),
          getUserId: () => Promise.resolve(null),
        },
      },
      headers: async () => ({ 'X-Async': 'async-value' }),
    }
    const { headers } = await buildRequestHeaders(config)
    expect((headers as Record<string, string>)['X-Async']).toBe('async-value')
  })

  it('returns userId from the adapter', async () => {
    const config: SolvaPayConfig = {
      auth: {
        adapter: {
          getToken: () => Promise.resolve('tok'),
          getUserId: () => Promise.resolve('uid-99'),
        },
      },
    }
    const { userId } = await buildRequestHeaders(config)
    expect(userId).toBe('uid-99')
  })
})
