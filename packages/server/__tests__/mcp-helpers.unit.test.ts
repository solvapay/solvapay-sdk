import { describe, expect, it } from 'vitest'
import { PaywallError, isPaywallStructuredContent } from '../src'
import { paywallToolResult } from '../src/mcp/paywallToolResult'
import {
  buildSolvaPayRequest,
  enrichPurchase,
  toolErrorResult,
  toolResult,
} from '../src/mcp/helpers'

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
  it('attaches _meta.ui with the resourceUri and default toolName', () => {
    const err = new PaywallError('Payment required', {
      kind: 'payment_required',
      product: 'prd_foo',
      checkoutUrl: 'https://example.com/checkout',
      message: 'Purchase required',
    })
    const result = paywallToolResult(err, { resourceUri: 'ui://my-app/mcp-app.html' })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual(err.structuredContent)
    expect(result._meta).toEqual({
      ui: { resourceUri: 'ui://my-app/mcp-app.html', toolName: 'open_paywall' },
    })
  })

  it('respects a custom toolName', () => {
    const err = new PaywallError('Activation required', {
      kind: 'activation_required',
      product: 'prd_bar',
      checkoutUrl: '',
      message: 'Activate',
    })
    const result = paywallToolResult(err, {
      resourceUri: 'ui://app/view.html',
      toolName: 'open_custom_paywall',
    })
    expect(result._meta).toEqual({
      ui: { resourceUri: 'ui://app/view.html', toolName: 'open_custom_paywall' },
    })
  })
})

describe('toolResult / toolErrorResult', () => {
  it('wraps structured content into an MCP tool result', () => {
    const result = toolResult({ hello: 'world' })
    expect(result.structuredContent).toEqual({ hello: 'world' })
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ hello: 'world' }) }])
  })

  it('marks error results with isError', () => {
    const result = toolErrorResult({ error: 'boom', status: 500 })
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({ error: 'boom', status: 500 })
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
