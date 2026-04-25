import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React, { createRef } from 'react'
import { MandateText } from './MandateText'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { merchantCache } from '../hooks/useMerchant'
import { MissingProviderError } from '../utils/errors'
import type { Merchant } from '../types'

const merchant: Merchant = {
  displayName: 'Acme',
  legalName: 'Acme Inc.',
  termsUrl: 'https://acme.com/terms',
}

beforeEach(() => {
  plansCache.clear()
  productCache.clear()
  merchantCache.clear()
  merchantCache.set('/api/merchant', { merchant, promise: null, timestamp: Date.now() })
  plansCache.set('prd_x', {
    plans: [
      {
        reference: 'pln',
        type: 'recurring',
        interval: 'month',
        price: 1999,
        currency: 'usd',
      },
    ],
    timestamp: Date.now(),
    promise: null,
  })
  productCache.set('prd_x', {
    product: { reference: 'prd_x', name: 'Widget API' },
    promise: null,
    timestamp: Date.now(),
  })
})

describe('MandateText primitive', () => {
  it('renders the recurring variant with merchant + price + interval', async () => {
    render(
      <SolvaPayProvider config={{}}>
        <MandateText planRef="pln" productRef="prd_x" data-testid="mandate" />
      </SolvaPayProvider>,
    )
    await waitFor(() => {
      const node = screen.getByTestId('mandate')
      expect(node.textContent).toContain('Acme Inc.')
      expect(node.textContent).toContain('$19.99')
      expect(node.textContent).toContain('every month')
      expect(node.getAttribute('data-variant')).toBe('recurring')
    })
  })

  it('asChild swaps <p> for consumer element and merges classes/refs', async () => {
    const ref = createRef<HTMLSpanElement>()
    render(
      <SolvaPayProvider config={{}}>
        <MandateText
          planRef="pln"
          productRef="prd_x"
          asChild
          data-testid="mandate"
          className="from-primitive"
        >
          <span ref={ref} className="from-consumer" />
        </MandateText>
      </SolvaPayProvider>,
    )
    await waitFor(() => {
      const node = screen.getByTestId('mandate')
      expect(node.tagName).toBe('SPAN')
      expect(node.className).toContain('from-primitive')
      expect(node.className).toContain('from-consumer')
      expect(ref.current).toBe(node)
    })
  })

  it('renders the topup variant when mode="topup"', async () => {
    render(
      <SolvaPayProvider config={{}}>
        <MandateText mode="topup" amountMinor={500} currency="usd" data-testid="mandate" />
      </SolvaPayProvider>,
    )
    await waitFor(() => {
      const node = screen.getByTestId('mandate')
      expect(node.getAttribute('data-variant')).toBe('topup')
      expect(node.textContent).toContain('$5')
      expect(node.textContent).toContain('Acme Inc.')
    })
  })

  it('throws MissingProviderError when rendered outside SolvaPayProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<MandateText planRef="pln" />)).toThrow(MissingProviderError)
    spy.mockRestore()
  })
})
