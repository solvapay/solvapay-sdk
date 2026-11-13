import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSolvaPayTokenVerifier } from '../src/verify-bearer'

const apiBaseUrl = 'https://api.solvapay.test/'

function answer(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('createSolvaPayTokenVerifier', () => {
  afterEach(() => vi.useRealTimers())

  it('asks SolvaPay userinfo and returns the customer it names', async () => {
    const fetchImpl = vi.fn(async () => answer(200, { sub: 'cus_REAL1' }))
    const verify = createSolvaPayTokenVerifier({ apiBaseUrl, fetchImpl })
    await expect(verify('tok_1')).resolves.toEqual({ customerRef: 'cus_REAL1' })
    expect(fetchImpl).toHaveBeenCalledWith('https://api.solvapay.test/v1/customer/auth/userinfo', {
      method: 'GET',
      headers: { Authorization: 'Bearer tok_1' },
    })
  })

  it('returns null for a token SolvaPay refuses (401 or 403), and does not cache it', async () => {
    const fetchImpl = vi.fn(async () => answer(401, { message: 'Unauthorized' }))
    const verify = createSolvaPayTokenVerifier({ apiBaseUrl, fetchImpl })
    await expect(verify('tok_bad')).resolves.toBeNull()
    await expect(verify('tok_bad')).resolves.toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    fetchImpl.mockResolvedValueOnce(answer(403))
    await expect(verify('tok_forbidden')).resolves.toBeNull()
  })

  it('fails loudly when SolvaPay answers anything else, or cannot be reached', async () => {
    const down = createSolvaPayTokenVerifier({
      apiBaseUrl,
      fetchImpl: vi.fn(async () => answer(503)),
    })
    await expect(down('tok')).rejects.toMatchObject({
      code: 'token_verification_failed',
      status: 503,
    })
    const unreachable = createSolvaPayTokenVerifier({
      apiBaseUrl,
      fetchImpl: vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    })
    await expect(unreachable('tok')).rejects.toMatchObject({ code: 'network_error' })
    const noCustomer = createSolvaPayTokenVerifier({
      apiBaseUrl,
      fetchImpl: vi.fn(async () => answer(200, {})),
    })
    await expect(noCustomer('tok')).rejects.toMatchObject({ code: 'token_verification_failed' })
  })

  it('caches a valid answer for cacheSeconds, then asks again', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'))
    const fetchImpl = vi.fn(async () => answer(200, { sub: 'cus_REAL1' }))
    const verify = createSolvaPayTokenVerifier({ apiBaseUrl, fetchImpl, cacheSeconds: 60 })
    await verify('tok_1')
    vi.setSystemTime(new Date('2026-11-13T12:00:59.999Z'))
    await verify('tok_1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-11-13T12:01:00Z'))
    await verify('tok_1')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('keeps at most maxEntries answers', async () => {
    const fetchImpl = vi.fn(async () => answer(200, { sub: 'cus_REAL1' }))
    const verify = createSolvaPayTokenVerifier({ apiBaseUrl, fetchImpl, maxEntries: 2 })
    await verify('a')
    await verify('b')
    await verify('c')
    await verify('a')
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })
})
