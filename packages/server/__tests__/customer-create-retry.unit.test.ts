import { describe, expect, it, vi } from 'vitest'
import { SolvaPayPaywall } from '../src/paywall'
import type { SolvaPayClient } from '../src/types'

/**
 * A create that fails with anything but 409 must not leave the user marked
 * as "attempted": the next call has to try again, never fall back to sending
 * the app's own user id to the API as if it were a customer ref.
 */
describe('customer creation after a failed create', () => {
  it('creates the customer on the next call instead of using the raw user id', async () => {
    let creates = 0
    const checkLimits = vi.fn(async () => ({ withinLimits: true, remaining: 5, plan: 'Pro' }))
    const client = {
      getCustomer: vi.fn(async () => {
        throw new Error('Get customer failed (404): {"message":"Customer not found"}')
      }),
      createCustomer: vi.fn(async () => {
        creates++
        if (creates === 1) throw new Error('Create customer failed (500): {"message":"boom"}')
        return { customerRef: 'cus_RETRY1' }
      }),
      checkLimits,
      trackUsage: vi.fn(async () => undefined),
    } as unknown as SolvaPayClient
    const paywall = new SolvaPayPaywall(client, { debug: false })
    const args = { auth: { customer_ref: 'user_create_retry_1' } }

    await expect(paywall.decide(args, { product: 'prd_retry' })).rejects.toThrow('500')
    const second = await paywall.decide(args, { product: 'prd_retry' })

    expect(creates).toBe(2)
    expect(second.customerRef).toBe('cus_RETRY1')
    expect(checkLimits).toHaveBeenCalledTimes(1)
    expect(checkLimits.mock.calls[0][0]).toMatchObject({ customerRef: 'cus_RETRY1' })
  })
})
