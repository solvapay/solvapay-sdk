import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSolvaPay } from '../src'
import type { SolvaPayClient } from '../src/types'

/**
 * Mock client that simulates the backend's "link on conflict" semantics:
 * - getCustomer({ externalRef }) returns null (404-style) until the customer
 *   is linked to that externalRef
 * - getCustomer({ email }) returns the customer whenever one exists
 * - createCustomer rejects with a 409 email-conflict error when an existing
 *   customer with that email is already stored and has no externalRef
 * - updateCustomer patches externalRef on an existing customer
 */
function makeClient(
  seed: Array<{
    customerRef: string
    email: string
    externalRef?: string
  }>,
) {
  const customers = new Map<
    string,
    { customerRef: string; email: string; externalRef?: string }
  >()
  for (const c of seed) customers.set(c.customerRef, { ...c })

  const calls = {
    getByExternalRef: 0,
    getByEmail: 0,
    create: 0,
    update: 0,
    lastUpdate: null as null | { customerRef: string; params: Record<string, unknown> },
  }

  const findByExternalRef = (externalRef: string) => {
    for (const c of customers.values()) {
      if (c.externalRef === externalRef) return c
    }
    return undefined
  }
  const findByEmail = (email: string) => {
    for (const c of customers.values()) {
      if (c.email.toLowerCase() === email.toLowerCase()) return c
    }
    return undefined
  }

  const client: SolvaPayClient = {
    async checkLimits() {
      return { withinLimits: true, remaining: 100, plan: 'free' }
    },
    async trackUsage() {},
    async getCustomer(params) {
      if (params.externalRef) {
        calls.getByExternalRef++
        const c = findByExternalRef(params.externalRef)
        if (!c) throw new Error('Get customer failed (404): not found')
        return {
          customerRef: c.customerRef,
          email: c.email,
          externalRef: c.externalRef,
          purchases: [],
        }
      }
      if (params.email) {
        calls.getByEmail++
        const c = findByEmail(params.email)
        if (!c) throw new Error('Get customer failed (404): not found')
        return {
          customerRef: c.customerRef,
          email: c.email,
          externalRef: c.externalRef,
          purchases: [],
        }
      }
      throw new Error('getCustomer requires customerRef, externalRef, or email')
    },
    async createCustomer(params) {
      calls.create++
      const email = params.email
      const existing = findByEmail(email)
      if (existing) {
        throw new Error(
          'Create customer failed (409): Customer with identifier email ' + email + ' already exists',
        )
      }
      const customerRef = 'cus_' + Math.random().toString(36).slice(2, 10)
      customers.set(customerRef, {
        customerRef,
        email,
        externalRef: params.externalRef,
      })
      return { customerRef }
    },
    async updateCustomer(customerRef, params) {
      calls.update++
      calls.lastUpdate = { customerRef, params }
      const existing = customers.get(customerRef)
      if (!existing) throw new Error('Update customer failed (404): not found')
      Object.assign(existing, params)
      return { customerRef }
    },
    async createCheckoutSession() {
      throw new Error('not used')
    },
    async createCustomerSession() {
      throw new Error('not used')
    },
  }

  return { client, customers, calls }
}

describe('ensureCustomer — backfills externalRef via updateCustomer', () => {
  let mock: ReturnType<typeof makeClient>

  beforeEach(() => {
    mock = makeClient([
      // Stale customer: exists from a previous product/tenant without any externalRef.
      { customerRef: 'cus_stale', email: 'alice@example.com' },
    ])
  })

  it('resolves email-matched customer and backfills externalRef on 409', async () => {
    const solvapay = createSolvaPay({ apiClient: mock.client })

    const resolved = await solvapay.ensureCustomer(
      'supabase-user-id',
      'supabase-user-id',
      { email: 'alice@example.com', name: 'Alice' },
    )

    expect(resolved).toBe('cus_stale')
    expect(mock.customers.get('cus_stale')?.externalRef).toBe('supabase-user-id')
    expect(mock.calls.update).toBe(1)
    expect(mock.calls.lastUpdate?.params).toEqual({ externalRef: 'supabase-user-id' })
  })

  it('skips updateCustomer when the existing customer already has an externalRef', async () => {
    // Override: existing already linked to a different externalRef
    mock = makeClient([
      {
        customerRef: 'cus_linked',
        email: 'bob@example.com',
        externalRef: 'other-user',
      },
    ])
    const solvapay = createSolvaPay({ apiClient: mock.client })

    // First create throws 409 (different externalRef), then getCustomer by email
    // returns the customer with externalRef !== ours, so the backfill path
    // should NOT call updateCustomer. We expect ensureCustomer to throw — but
    // `byEmail.externalRef` is truthy so we skip the update attempt.
    await expect(
      solvapay.ensureCustomer('bob-user-id', 'bob-user-id', {
        email: 'bob@example.com',
      }),
    ).resolves.toBe('cus_linked')

    expect(mock.calls.update).toBe(0)
  })
})

describe('SolvaPayClient.updateCustomer wiring', () => {
  it('is called with (customerRef, patch) when backfilling', async () => {
    const mock = makeClient([
      { customerRef: 'cus_fresh', email: 'carol@example.com' },
    ])
    const spyUpdate = vi.spyOn(mock.client, 'updateCustomer')

    const solvapay = createSolvaPay({ apiClient: mock.client })

    await solvapay.ensureCustomer('carol-user-id', 'carol-user-id', {
      email: 'carol@example.com',
    })

    expect(spyUpdate).toHaveBeenCalledWith('cus_fresh', { externalRef: 'carol-user-id' })
  })
})
