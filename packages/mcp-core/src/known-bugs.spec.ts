import { describe, expect, it } from 'vitest'
import { narrateManageAccount } from './narrate'
import { buildResponseContext } from './response-context'
import { defaultIsChatGptRequest } from './hideToolsByAudience'
import { buildSolvaPayDescriptors } from './descriptors'
import type { BootstrapPayload } from './types'

function payload(plans: unknown[]): BootstrapPayload {
  return {
    view: 'account',
    productRef: 'prd_x',
    stripePublishableKey: null,
    returnUrl: 'https://example.test/r',
    merchant: { displayName: 'Acme', legalName: 'Acme Inc.' } as never,
    product: { reference: 'prd_x', name: 'Docs API' } as never,
    plans: plans as never,
    customer: null,
  }
}

describe('narration of plans', () => {
  it('treats a plan priced only in tier bands as paid', () => {
    const { text } = narrateManageAccount(
      payload([
        {
          type: 'usage-based',
          name: 'Banded',
          requiresPayment: true,
          options: [
            {
              kind: 'tier',
              from: 0,
              to: null,
              mode: 'graduated',
              charge: { per: 'unit', amountMinor: 5, currency: 'usd', meter: 'requests' },
            },
          ],
        },
      ]),
    )
    expect(text).not.toContain('Banded requires no payment')
  })

  it('names one unit of an -es meter correctly', () => {
    const plan = (meter: string) => ({
      type: 'usage-based',
      name: `By ${meter}`,
      requiresPayment: true,
      options: [{ kind: 'charge', per: 'unit', amountMinor: 5, currency: 'usd', meter }],
    })
    const { text } = narrateManageAccount(
      payload([plan('searches'), plan('boxes'), plan('queries'), plan('tokens'), plan('access')]),
    )
    expect(text).toContain('per search')
    expect(text).not.toContain('per searche')
    expect(text).toContain('per box')
    expect(text).toContain('per query')
    expect(text).toContain('per token')
    expect(text).toContain('per access')
  })

  it('says a priced recurring plan with no currency is billed, not "is a year"', () => {
    const { text } = narrateManageAccount(
      payload([
        {
          type: 'recurring',
          name: 'Patron',
          price: 1000,
          requiresPayment: true,
          options: [{ kind: 'billingCycle', interval: 'year' }],
        },
      ]),
    )
    expect(text).not.toContain('Patron is a year')
    expect(text).toContain('Patron is billed every year')
  })
})

describe('response context', () => {
  it('reads the customer plan from planRef, which the API sends', () => {
    const { ctx } = buildResponseContext({
      customerRef: 'cus_x',
      limits: { withinLimits: true, remaining: 3, planRef: 'pln_x' } as never,
      product: 'prd_x',
      solvaPay: {} as never,
    })
    expect(ctx.customer.plan).toEqual({ reference: 'pln_x' })
  })
})

describe('ChatGPT bypass', () => {
  it('finds the user-agent on the MCP SDK v2 request context (ctx.http.req)', () => {
    const req = new Request('https://mcp.example.test/mcp', {
      headers: { 'user-agent': 'openai-mcp/1.0' },
    })
    expect(defaultIsChatGptRequest({ server: {}, extra: { http: { req } } })).toBe(true)
  })
})

describe('descriptors', () => {
  it('rejects a non-http publicBaseUrl with a stable code', () => {
    let caught: unknown
    try {
      buildSolvaPayDescriptors({
        solvaPay: {} as never,
        productRef: 'prd_x',
        resourceUri: 'ui://x/mcp-app.html',
        readHtml: async () => '',
        publicBaseUrl: 'ui://not-http',
      })
    } catch (error) {
      caught = error
    }
    expect((caught as { code?: string } | undefined)?.code).toBe('invalid_argument')
  })
})
