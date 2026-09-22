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

const linkByHref = (href: string): HTMLElement => {
  const match = screen.getAllByRole('link').find(link => link.getAttribute('href') === href)
  if (!match) throw new Error(`expected a link to ${href}`)
  return match
}

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
    expect(node.textContent).toContain('Terms of Service')
    expect(node.textContent).toContain('Privacy Policy')
    expect(node.textContent).toContain("Acme's")
    expect(node.textContent).toContain("SolvaPay's")
  })

  it('linkifies merchant and SolvaPay legal URLs when both merchant URLs are set', async () => {
    primeMerchant()
    render(
      <SolvaPayProvider config={{}}>
        <MandateText mode="topup" amountMinor={500} currency="usd" />
      </SolvaPayProvider>,
    )

    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(4))
    const merchantTerms = linkByHref('https://acme.com/terms')
    const merchantPrivacy = linkByHref('https://acme.com/privacy')
    const solvaTerms = linkByHref('https://solvapay.com/legal/terms')
    const solvaPrivacy = linkByHref('https://solvapay.com/legal/privacy')
    expect(merchantTerms.textContent).toBe('Terms of Service')
    expect(merchantPrivacy.textContent).toBe('Privacy Policy')
    expect(solvaTerms.textContent).toBe('Terms of Service')
    expect(solvaPrivacy.textContent).toBe('Privacy Policy')
    expect(merchantTerms.getAttribute('target')).toBe('_blank')
    expect(merchantTerms.getAttribute('rel')).toBe('noopener noreferrer')
    expect(merchantTerms.getAttribute('data-solvapay-mandate-link')).toBe('')
    expect(screen.getByText(/Acme Inc\./).textContent).toContain("Acme's")
    expect(screen.getByText(/Acme Inc\./).textContent).toContain("SolvaPay's")
  })

  it('names the merchant Terms of Service plus both SolvaPay links when only termsUrl is set', async () => {
    merchantCache.set('/api/merchant', {
      merchant: {
        displayName: 'Acme',
        legalName: 'Acme Inc.',
        termsUrl: 'https://acme.com/terms',
      },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{}}>
        <MandateText mode="topup" amountMinor={500} currency="usd" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(3))
    expect(linkByHref('https://acme.com/terms').textContent).toBe('Terms of Service')
    expect(linkByHref('https://solvapay.com/legal/terms').textContent).toBe('Terms of Service')
    expect(linkByHref('https://solvapay.com/legal/privacy').textContent).toBe('Privacy Policy')
    expect(
      screen
        .getAllByRole('link')
        .some(link => link.getAttribute('href') === 'https://acme.com/privacy'),
    ).toBe(false)
    expect(screen.getByText(/Acme Inc\./).textContent).toContain("Acme's")
  })

  it('names only SolvaPay legal pages when the merchant has neither URL', async () => {
    merchantCache.set('/api/merchant', {
      merchant: { displayName: 'Plain', legalName: 'Plain LLC' },
      promise: null,
      timestamp: Date.now(),
    })
    render(
      <SolvaPayProvider config={{}}>
        <MandateText mode="topup" amountMinor={500} currency="usd" />
      </SolvaPayProvider>,
    )
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(2))
    expect(linkByHref('https://solvapay.com/legal/terms').textContent).toBe('Terms of Service')
    expect(linkByHref('https://solvapay.com/legal/privacy').textContent).toBe('Privacy Policy')
    const text = screen.getByText(/Plain LLC/).textContent
    expect(text).toContain("SolvaPay's")
    expect(text).not.toContain("Plain's")
    expect(text).not.toContain("Plain LLC's")
    expect(text).toContain('You agree to')
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
    expect(node.textContent).toContain('a one-time')
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

  it('renders the SolvaPay consent tail on one-time checkout when merchant URLs are missing', async () => {
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
    expect(node.textContent).toContain('You agree to')
    expect(node.textContent).toContain("SolvaPay's")
    expect(node.textContent).not.toContain('See ')
    expect(linkByHref('https://solvapay.com/legal/terms').textContent).toBe('Terms of Service')
    expect(linkByHref('https://solvapay.com/legal/privacy').textContent).toBe('Privacy Policy')
  })
})
