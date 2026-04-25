import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSolvaPayClient } from '../src/index'

/**
 * Regression guard: `POST /v1/sdk/customers` returns `{ reference, ... }` from
 * the backend, but the SDK's `createCustomer` interface declares its return
 * as `{ customerRef }`. The client must map at the boundary — same pattern
 * as `updateCustomer` and `getCustomer`.
 */
describe('createSolvaPayClient().createCustomer — response mapping', () => {
  afterEach(() => {
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
