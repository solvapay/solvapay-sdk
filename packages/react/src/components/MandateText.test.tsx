import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import React from 'react'
import { MandateText } from './MandateText'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { plansCache } from '../hooks/usePlans'
import { productCache } from '../hooks/useProduct'
import { merchantCache } from '../hooks/useMerchant'
import type { Plan, Merchant } from '../types'

const merchant: Merchant = {
  displayName: 'Acme',
  legalName: 'Acme Inc.',
  termsUrl: 'https://acme.com/terms',
  privacyUrl: 'https://acme.com/privacy',
}

const primeMerchant = () => {
  merchantCache.set('/api/merchant', {
    merchant,
    promise: null,
    timestamp: Date.now(),
  })
}

const primePlan = (plan: Plan, productRef = 'prd_x') => {
  plansCache.set(productRef, {
    plans: [plan],
    timestamp: Date.now(),
    promise: null,
  })
}

const primeProduct = (name = 'Widget API', productRef = 'prd_x') => {
  productCache.set(productRef, {
    product: { reference: productRef, name },
    promise: null,
    timestamp: Date.now(),
  })
}

beforeEach(() => {
  plansCache.clear()
  productCache.clear()
  merchantCache.clear()
})

describe('MandateText', () => {
  it('renders recurring mandate with legal name, interval, price, and terms', async () => {
    primeMerchant()
    primeProduct()
    primePlan({
      reference: 'pln',
      type: 'recurring',
      interval: 'month',
      price: 1999,
      currency: 'usd',
    })

    render(
      <SolvaPayProvider config={{}}>
        <MandateText planRef="pln" productRef="prd_x" />
      </SolvaPayProvider>,
    )

    await waitFor(() => expect(screen.getByText(/Acme Inc\./)).toBeTruthy())
    const node = screen.getByText(/Acme Inc\./)
    expect(node.textContent).toContain('$19.99')
    expect(node.textContent).toContain('every month')
    expect(node.textContent).toContain('acme.com/terms')
    expect(node.textContent).toContain('acme.com/privacy')
  })

  it('renders one-time mandate without interval', async () => {
    primeMerchant()
    primeProduct()
    primePlan({
      reference: 'pln',
      type: 'one-time',
      price: 4999,
      currency: 'usd',
    })
    render(
      <SolvaPayProvider config={{}}>
        <MandateText planRef="pln" productRef="prd_x" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText(/confirming/)).toBeTruthy())
    const node = screen.getByText(/confirming/)
    expect(node.textContent).toContain('$49.99')
    expect(node.textContent).toContain('Widget API')
    expect(node.textContent).not.toContain('every')
  })

  it('renders topup mandate when mode="topup"', async () => {
    primeMerchant()
    render(
      <SolvaPayProvider config={{}}>
        <MandateText mode="topup" amountMinor={500} currency="usd" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText(/Credits are non-refundable/)).toBeTruthy())
    const node = screen.getByText(/Credits are non-refundable/)
    expect(node.textContent).toContain('$5')
    expect(node.textContent).toContain('Acme Inc.')
  })

  it('honours copy override for recurring mandate', async () => {
    primeMerchant()
    primeProduct()
    primePlan({
      reference: 'pln',
      type: 'recurring',
      interval: 'month',
      price: 1999,
      currency: 'usd',
    })
    render(
      <SolvaPayProvider
        config={{
          copy: {
            mandate: {
              recurring: () => 'Custom mandate text',
            },
          },
        }}
      >
        <MandateText planRef="pln" productRef="prd_x" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText('Custom mandate text')).toBeTruthy())
  })

  it('gracefully omits terms sentence when URLs are missing', async () => {
    merchantCache.set('/api/merchant', {
      merchant: { displayName: 'Plain', legalName: 'Plain LLC' },
      promise: null,
      timestamp: Date.now(),
    })
    primeProduct()
    primePlan({
      reference: 'pln',
      type: 'one-time',
      price: 1000,
      currency: 'usd',
    })
    render(
      <SolvaPayProvider config={{}}>
        <MandateText planRef="pln" productRef="prd_x" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getByText(/Plain LLC/)).toBeTruthy())
    const node = screen.getByText(/Plain LLC/)
    expect(node.textContent).not.toContain('See ')
  })
})
