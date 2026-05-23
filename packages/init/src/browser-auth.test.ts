import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInitSession,
  openAuthUrl,
  verifyProductRef,
  verifySecretKey,
  waitForExchange,
} from './browser-auth'

vi.mock('open', () => ({
  default: vi.fn(),
}))

import open from 'open'

describe('createInitSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the parsed session payload on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: 's1',
          authUrl: 'https://app.solvapay.com/auth/cli-init?session_id=s1',
          pollToken: 'poll',
        }),
      }),
    )

    const result = await createInitSession('https://api.solvapay.com')

    expect(result.sessionId).toBe('s1')
    expect(result.authUrl).toContain('cli-init')
    expect(result.pollToken).toBe('poll')
  })

  it('throws when the API rejects the session creation request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'boom',
      }),
    )

    await expect(createInitSession('https://api.solvapay.com')).rejects.toThrow(
      /Failed to start init session \(500\)/,
    )
  })
})

describe('openAuthUrl', () => {
  beforeEach(() => {
    vi.mocked(open).mockReset()
  })

  it('returns true when `open` resolves', async () => {
    vi.mocked(open).mockResolvedValue({} as never)
    expect(await openAuthUrl('https://example.com')).toBe(true)
  })

  it('returns false when `open` throws (e.g. headless environment)', async () => {
    vi.mocked(open).mockRejectedValue(new Error('no display'))
    expect(await openAuthUrl('https://example.com')).toBe(false)
  })
})

describe('waitForExchange', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const session = {
    sessionId: 's1',
    authUrl: 'https://app.solvapay.com/auth/cli-init?session_id=s1',
    pollToken: 'poll-tok',
  }

  it('returns the complete payload once the exchange resolves', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ status: 202 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'complete',
          secretKey: 'sk_test_abc',
          email: 'dev@example.com',
        }),
      })
    vi.stubGlobal('fetch', fetchSpy)

    const promise = waitForExchange('https://api.solvapay.com', session)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.status).toBe('complete')
    expect(result.secretKey).toBe('sk_test_abc')
    expect(result.email).toBe('dev@example.com')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const init = (fetchSpy.mock.calls[0] ?? [])[1] as { headers?: Record<string, string> } | undefined
    expect(init?.headers?.Authorization).toBe('Bearer poll-tok')
  })

  it('returns expired when the timeout window elapses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 202 }),
    )

    const promise = waitForExchange('https://api.solvapay.com', session)
    // Advance well beyond the 10-minute window
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000)
    const result = await promise

    expect(result.status).toBe('expired')
  })

  it('returns cancelled when the API signals cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: 'cancelled' }),
        }),
    )

    const promise = waitForExchange('https://api.solvapay.com', session)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result.status).toBe('cancelled')
  })
})

describe('verifySecretKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns ok: true on 2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    const result = await verifySecretKey('https://api.solvapay.com', 'sk_test')
    expect(result.ok).toBe(true)
  })

  it('returns ok: false with warning on HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }),
    )
    const result = await verifySecretKey('https://api.solvapay.com', 'sk_bad')
    expect(result.ok).toBe(false)
    expect(result.warning).toContain('401')
  })
})

describe('verifyProductRef', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('flags the placeholder ref without calling fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await verifyProductRef(
      'https://api.solvapay.com',
      'sk_test',
      '__SOLVAPAY_PRODUCT_REF__',
    )

    expect(result.status).toBe('invalid_placeholder')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns ok for a verified ref', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    const result = await verifyProductRef('https://api.solvapay.com', 'sk_test', 'prd_real')
    expect(result.status).toBe('ok')
  })

  it('returns not_found for a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'missing' }),
    )
    const result = await verifyProductRef('https://api.solvapay.com', 'sk_test', 'prd_missing')
    expect(result.status).toBe('not_found')
  })
})
