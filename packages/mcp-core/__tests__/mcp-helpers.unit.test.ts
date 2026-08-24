import { describe, expect, it, vi } from 'vitest'
import { PaywallError, isPaywallStructuredContent } from '@solvapay/server'
import {
  buildSolvaPayRequest,
  defaultGetCustomerRef,
  enrichPurchase,
  paywallToolResult,
  toolErrorResult,
  toolResult,
} from '../src'

describe('isPaywallStructuredContent', () => {
  it('accepts payment_required content', () => {
    expect(
      isPaywallStructuredContent({
        kind: 'payment_required',
        product: 'prd_foo',
        checkoutUrl: 'https://example.com/checkout',
        message: 'pay up',
      }),
    ).toBe(true)
  })

  it('accepts activation_required content', () => {
    expect(
      isPaywallStructuredContent({
        kind: 'activation_required',
        product: 'prd_foo',
        checkoutUrl: 'https://example.com/activate',
        message: 'activate',
      }),
    ).toBe(true)
  })

  it('rejects unknown kinds', () => {
    expect(isPaywallStructuredContent({ kind: 'something_else' })).toBe(false)
  })

  it('rejects primitives and null', () => {
    expect(isPaywallStructuredContent(null)).toBe(false)
    expect(isPaywallStructuredContent('payment_required')).toBe(false)
    expect(isPaywallStructuredContent(42)).toBe(false)
    expect(isPaywallStructuredContent(undefined)).toBe(false)
  })

  it('rejects objects without a kind', () => {
    expect(isPaywallStructuredContent({ product: 'prd_foo' })).toBe(false)
  })
})

describe('paywallToolResult', () => {
  it('ships the gate verbatim on structuredContent with isError:false and narration text', async () => {
    const err = new PaywallError('Payment required', {
      kind: 'payment_required',
      product: 'prd_foo',
      checkoutUrl: 'https://example.com/checkout',
      message: 'Purchase required',
    })
    const result = await paywallToolResult(err)
    // Paywall is a user-actionable gate, not a tool failure. The
    // LLM narrates recovery from `content[0].text` and
    // `structuredContent` stays available for programmatic
    // consumers.
    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual(err.structuredContent)
    expect(result.content).toEqual([{ type: 'text', text: err.message }])
    // Per-call `_meta.ui` is no longer stamped anywhere — the widget
    // iframe for payable data tools has been removed.
    expect(result._meta).toBeUndefined()
  })

  it('accepts a PaywallStructuredContent gate directly (decide() form)', async () => {
    const gate = {
      kind: 'payment_required' as const,
      product: 'prd_foo',
      checkoutUrl: 'https://example.com/checkout',
      message: 'Purchase required',
    }
    const result = await paywallToolResult(gate)
    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual(gate)
    expect(result.content).toEqual([{ type: 'text', text: gate.message }])
    expect(result._meta).toBeUndefined()
  })

  it('ignores buildBootstrap when passed (text-only path does not invoke the bootstrap builder)', async () => {
    const err = new PaywallError('Activation required', {
      kind: 'activation_required',
      product: 'prd_bar',
      checkoutUrl: '',
      message: 'Activate',
    })
    const buildBootstrap = vi.fn()
    const result = await paywallToolResult(err, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      buildBootstrap: buildBootstrap as any,
    })
    expect(buildBootstrap).not.toHaveBeenCalled()
    expect(result.isError).toBe(false)
    expect(result.structuredContent).toEqual(err.structuredContent)
    expect(result._meta).toBeUndefined()
  })
})

describe('toolResult / toolErrorResult', () => {
  it('wraps structured content into an MCP tool result', () => {
    const result = toolResult({ hello: 'world' })
    expect(result.structuredContent).toEqual({ hello: 'world' })
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ hello: 'world' }) }])
  })

  it('marks error results with isError and keeps the payload on structuredContent', () => {
    const result = toolErrorResult({ error: 'boom', status: 500 })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({ error: 'boom', status: 500 })
  })

  it('puts the human-readable short message in content[0].text when details is absent', () => {
    const result = toolErrorResult({ error: 'boom', status: 500 })
    expect(result.content).toEqual([{ type: 'text', text: 'boom' }])
  })

  it('prefers details over error in content[0].text when both are present', () => {
    const result = toolErrorResult({
      error: 'merchant lookup failed',
      status: 404,
      details:
        'Provider not found. Run `npx solvapay init` to create a merchant before deploying.',
    })
    expect(result.content).toEqual([
      {
        type: 'text',
        text:
          'Provider not found. Run `npx solvapay init` to create a merchant before deploying.',
      },
    ])
  })
})

describe('defaultGetCustomerRef', () => {
  // The official SDK v2 nests the auth envelope under `http`. Reading
  // only the flat v1 location silently de-authenticated every tool call.
  it('reads the customer_ref from the SDK v2 http.authInfo location', () => {
    expect(
      defaultGetCustomerRef({
        http: { authInfo: { extra: { customer_ref: 'cus_v2' } } },
      }),
    ).toBe('cus_v2')
  })

  it('reads the customer_ref from the flat SDK v1 authInfo location', () => {
    expect(defaultGetCustomerRef({ authInfo: { extra: { customer_ref: 'cus_v1' } } })).toBe(
      'cus_v1',
    )
  })

  it('prefers http.authInfo when both locations are present', () => {
    expect(
      defaultGetCustomerRef({
        http: { authInfo: { extra: { customer_ref: 'cus_v2' } } },
        authInfo: { extra: { customer_ref: 'cus_v1' } },
      }),
    ).toBe('cus_v2')
  })

  it('trims whitespace and treats a blank ref as absent', () => {
    expect(
      defaultGetCustomerRef({ http: { authInfo: { extra: { customer_ref: '  cus_pad  ' } } } }),
    ).toBe('cus_pad')
    expect(
      defaultGetCustomerRef({ http: { authInfo: { extra: { customer_ref: '   ' } } } }),
    ).toBeNull()
  })

  it('returns null when there is no auth context at all', () => {
    expect(defaultGetCustomerRef(undefined)).toBeNull()
    expect(defaultGetCustomerRef({})).toBeNull()
    expect(defaultGetCustomerRef({ http: {} })).toBeNull()
  })
})

describe('buildSolvaPayRequest', () => {
  it('forwards the customer_ref from MCP auth context as x-user-id', () => {
    const req = buildSolvaPayRequest(
      { authInfo: { token: 't', clientId: 'c', scopes: [], extra: { customer_ref: 'cus_123' } } },
      { method: 'POST', body: { ping: true } },
    )
    expect(req.method).toBe('POST')
    expect(req.headers.get('x-user-id')).toBe('cus_123')
    expect(req.headers.get('content-type')).toBe('application/json')
  })

  it('forwards the customer_ref from the SDK v2 http.authInfo location', () => {
    const req = buildSolvaPayRequest({
      http: {
        authInfo: { token: 't', clientId: 'c', scopes: [], extra: { customer_ref: 'cus_v2' } },
      },
    })
    expect(req.headers.get('x-user-id')).toBe('cus_v2')
  })

  it('encodes query parameters', () => {
    const req = buildSolvaPayRequest(undefined, {
      query: { productRef: 'prd_foo', planRef: undefined, other: 'bar' },
    })
    const url = new URL(req.url)
    expect(url.searchParams.get('productRef')).toBe('prd_foo')
    expect(url.searchParams.has('planRef')).toBe(false)
    expect(url.searchParams.get('other')).toBe('bar')
  })

  it('omits x-user-id when no customer_ref is present', () => {
    const req = buildSolvaPayRequest(undefined)
    expect(req.headers.get('x-user-id')).toBeNull()
  })

  it('respects a custom getCustomerRef override', () => {
    const req = buildSolvaPayRequest(undefined, { getCustomerRef: () => 'override_ref' })
    expect(req.headers.get('x-user-id')).toBe('override_ref')
  })
})

describe('enrichPurchase', () => {
  it('adds a priceDisplay for originalAmount + currency', () => {
    const enriched = enrichPurchase({
      reference: 'pur_1',
      amount: 5426,
      originalAmount: 50000,
      currency: 'sek',
    })
    expect(enriched.priceDisplay).toMatch(/SEK/)
    // USD equivalent shown alongside because currency !== USD.
    expect(enriched.priceUsdDisplay).toMatch(/\$/)
  })

  it('falls back to USD when originalAmount is missing', () => {
    const enriched = enrichPurchase({ reference: 'pur_2', amount: 1234 })
    expect(enriched.priceDisplay).toMatch(/\$/)
    expect(enriched.priceUsdDisplay).toBeUndefined()
  })

  it('does not add priceUsdDisplay for USD purchases', () => {
    const enriched = enrichPurchase({
      reference: 'pur_3',
      amount: 1000,
      originalAmount: 1000,
      currency: 'usd',
    })
    expect(enriched.priceDisplay).toMatch(/\$/)
    expect(enriched.priceUsdDisplay).toBeUndefined()
  })

  it('enriches the nested planSnapshot when it has a price', () => {
    const enriched = enrichPurchase({
      reference: 'pur_4',
      amount: 1000,
      originalAmount: 50000,
      currency: 'sek',
      planSnapshot: { price: 50000, currency: 'sek', name: 'Pro' },
    })
    const snap = enriched.planSnapshot as Record<string, unknown>
    expect(snap.priceDisplay).toMatch(/SEK/)
  })
})
