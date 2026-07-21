import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createSolvaPayClient } from '../src/index'

/**
 * Regression guard: `POST /v1/sdk/customers` returns `{ reference, ... }` from
 * the backend, but the SDK's `createCustomer` interface declares its return
 * as `{ customerRef }`. The client must map at the boundary — same pattern
 * as `updateCustomer` and `getCustomer`.
 *
 * Forces `SOLVAPAY_IMPL=ts` — this suite characterizes the retained TypeScript
 * fetch body / response mapping. Rust-side mapping is covered by
 * `client_group_a_fixtures` + `client-native-dispatch.unit.test.ts`.
 */
describe('createSolvaPayClient().createCustomer — response mapping', () => {
  const originalImpl = process.env.SOLVAPAY_IMPL

  beforeEach(() => {
    process.env.SOLVAPAY_IMPL = 'ts'
  })

  afterEach(() => {
    if (originalImpl === undefined) {
      delete process.env.SOLVAPAY_IMPL
    } else {
      process.env.SOLVAPAY_IMPL = originalImpl
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const mockFetchOk = (body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response),
    )

  it('maps backend { reference } → { customerRef }', async () => {
    mockFetchOk({ reference: 'cus_xyz', email: 'a@b.c', name: 'A' })
    const client = createSolvaPayClient({
      apiKey: 'sk_test',
      apiBaseUrl: 'http://localhost',
    })

    await expect(
      client.createCustomer!({ email: 'a@b.c', metadata: {} }),
    ).resolves.toEqual({ customerRef: 'cus_xyz' })
  })

  it('prefers reference over customerRef when both are present', async () => {
    mockFetchOk({ reference: 'cus_from_reference', customerRef: 'cus_from_customerRef' })
    const client = createSolvaPayClient({
      apiKey: 'sk_test',
      apiBaseUrl: 'http://localhost',
    })

    await expect(
      client.createCustomer!({ email: 'a@b.c', metadata: {} }),
    ).resolves.toEqual({ customerRef: 'cus_from_reference' })
  })

  it('falls back to customerRef when the backend shape lacks reference', async () => {
    mockFetchOk({ customerRef: 'cus_from_customerRef' })
    const client = createSolvaPayClient({
      apiKey: 'sk_test',
      apiBaseUrl: 'http://localhost',
    })

    await expect(
      client.createCustomer!({ email: 'a@b.c', metadata: {} }),
    ).resolves.toEqual({ customerRef: 'cus_from_customerRef' })
  })
})
