import { describe, expect, it } from 'vitest'
import {
  PAYMENT_RETURN_PATH,
  isPaymentReturnPath,
  paymentReturnResponse,
  paymentReturnUrl,
  renderPaymentReturnPage,
} from '../src/payment-return'

describe('payment return page', () => {
  it('builds the return URL under publicBaseUrl with or without a trailing slash', () => {
    expect(paymentReturnUrl('https://mcp.example.test')).toBe(
      'https://mcp.example.test/solvapay/payment-return',
    )
    expect(paymentReturnUrl('https://mcp.example.test/')).toBe(
      'https://mcp.example.test/solvapay/payment-return',
    )
    expect(PAYMENT_RETURN_PATH).toBe('/solvapay/payment-return')
  })

  it('matches its own path only', () => {
    expect(isPaymentReturnPath('/solvapay/payment-return')).toBe(true)
    expect(isPaymentReturnPath('/solvapay/payment-return/')).toBe(true)
    expect(isPaymentReturnPath('/solvapay/payment-return/x')).toBe(false)
    expect(isPaymentReturnPath('/mcp')).toBe(false)
  })

  it('renders a static page that names no rail and escapes the brand name', () => {
    const html = renderPaymentReturnPage({ brandName: 'Acme <Payments>' })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('Acme &lt;Payments&gt;')
    expect(html).toContain('Authentication complete')
    expect(html).not.toMatch(/stripe|pi_|pm_|acct_/i)
    expect(renderPaymentReturnPage()).toContain('SolvaPay')
  })

  it('answers GET with HTML that is never cached', async () => {
    const res = paymentReturnResponse()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toContain('Authentication complete')
  })
})
