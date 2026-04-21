import { describe, expect, it } from 'vitest'
import { createPaywall } from '../src/paywall'
import type { SolvaPayClient } from '../src/types'
import { isPaywallStructuredContent } from '../src'

/**
 * `createPaywall(...).createMCPHandler(...)` now catches `PaywallError` and
 * returns a `PaywallToolResult` so integrators don't need a `try/catch`
 * around the returned handler. The `_meta.ui` envelope is still attached
 * by the registration layer — this test only covers the protocol
 * conversion.
 */

function makeClient(blocking: boolean): SolvaPayClient {
  const client: Record<string, unknown> = {
    checkLimits: async () =>
      blocking
        ? {
            withinLimits: false,
            remaining: 0,
            plan: 'free',
            checkoutUrl: 'https://example.com/checkout',
          }
        : { withinLimits: true, remaining: 10, plan: 'free' },
    trackUsage: async () => undefined,
    createCustomer: async (params: { email: string }) => ({
      customerRef: `cus_${params.email.replace(/\W/g, '_')}`,
    }),
    getCustomer: async (params: { customerRef?: string; externalRef?: string }) => {
      const ref = params.customerRef || params.externalRef || 'anon'
      if (!ref.startsWith('cus_')) {
        throw new Error('404 - Customer not found')
      }
      return {
        customerRef: ref,
        email: `${ref}@example.com`,
      }
    },
  }
  return client as unknown as SolvaPayClient
}

describe('createMCPHandler auto-converts PaywallError', () => {
  it('returns a PaywallToolResult when the paywall fires', async () => {
    const { createMCPHandler } = createPaywall({ apiClient: makeClient(true) })
    const handler = createMCPHandler(
      { product: 'prd_test' },
      async () => ({ ok: true }),
    )

    const result = (await handler({ auth: { customer_ref: 'cus_test' } })) as {
      isError?: boolean
      structuredContent?: unknown
    }

    expect(result.isError).toBe(true)
    expect(isPaywallStructuredContent(result.structuredContent)).toBe(true)
  })

  it('passes successful responses through unchanged', async () => {
    const { createMCPHandler } = createPaywall({ apiClient: makeClient(false) })
    const handler = createMCPHandler(
      { product: 'prd_test' },
      async () => ({ ok: true }),
    )

    const result = await handler({ auth: { customer_ref: 'cus_test' } })
    expect(result).toEqual({ ok: true })
  })

  it('re-throws non-PaywallError exceptions', async () => {
    const { createMCPHandler } = createPaywall({ apiClient: makeClient(false) })
    const handler = createMCPHandler({ product: 'prd_test' }, async () => {
      throw new Error('boom')
    })

    await expect(handler({ auth: { customer_ref: 'cus_test' } })).rejects.toThrow('boom')
  })
})
