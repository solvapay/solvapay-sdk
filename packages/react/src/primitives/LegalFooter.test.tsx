import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React, { createRef } from 'react'
import { LegalFooter } from './LegalFooter'
import { CopyProvider } from '../i18n/context'

describe('LegalFooter primitive', () => {
  it('renders Terms and Privacy links pointing at SolvaPay legal URLs', () => {
    render(<LegalFooter data-testid="footer" />)

    const terms = screen.getByRole('link', { name: 'Terms' })
    const privacy = screen.getByRole('link', { name: 'Privacy' })

    expect(terms.getAttribute('href')).toBe('https://solvapay.com/legal/terms')
    expect(privacy.getAttribute('href')).toBe('https://solvapay.com/legal/privacy')
    expect(terms.getAttribute('target')).toBe('_blank')
    expect(privacy.getAttribute('target')).toBe('_blank')
    expect(terms.getAttribute('rel')).toBe('noopener noreferrer')
    expect(privacy.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('defaults to the "provided" attribution linking solvapay.com', () => {
    render(<LegalFooter />)
    const attribution = screen.getByRole('link', { name: 'Provided by SolvaPay' })
    expect(attribution.getAttribute('href')).toBe('https://solvapay.com')
    expect(attribution.getAttribute('target')).toBe('_blank')
  })

  it('renders the "powered" attribution variant', () => {
    render(<LegalFooter attribution="powered" />)
    expect(screen.getByRole('link', { name: 'Powered by SolvaPay' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Provided by SolvaPay' })).toBeNull()
  })

  it('omits the attribution line when attribution={false}', () => {
    render(<LegalFooter attribution={false} />)
    expect(screen.queryByRole('link', { name: /by SolvaPay/ })).toBeNull()
    // Terms + Privacy still render.
    expect(screen.getByRole('link', { name: 'Terms' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeTruthy()
  })

  it('honors termsUrl/privacyUrl overrides', () => {
    render(
      <LegalFooter
        termsUrl="https://example.com/tos"
        privacyUrl="https://example.com/privacy"
      />,
    )
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe(
      'https://example.com/tos',
    )
    expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe(
      'https://example.com/privacy',
    )
  })

  it('honors copy overrides via <CopyProvider>', () => {
    render(
      <CopyProvider
        copy={{
          legalFooter: {
            terms: 'Vilkår',
            privacy: 'Personvern',
            providedBy: 'Levert av SolvaPay',
            poweredBy: 'Drevet av SolvaPay',
          },
        }}
      >
        <LegalFooter />
      </CopyProvider>,
    )
    expect(screen.getByRole('link', { name: 'Vilkår' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Personvern' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Levert av SolvaPay' })).toBeTruthy()
  })

  it('asChild swaps the wrapper element and forwards refs/classes', () => {
    const ref = createRef<HTMLElement>()
    render(
      <LegalFooter asChild data-testid="footer" className="from-primitive">
        <footer ref={ref} className="from-consumer" />
      </LegalFooter>,
    )
    const node = screen.getByTestId('footer')
    expect(node.tagName.toLowerCase()).toBe('footer')
    expect(node.className).toContain('from-primitive')
    expect(node.className).toContain('from-consumer')
    expect(ref.current).toBe(node)
    expect(node.getAttribute('data-solvapay-legal-footer')).toBe('')
  })

  it('renders without a SolvaPayProvider (depends only on CopyContext)', () => {
    expect(() => render(<LegalFooter />)).not.toThrow()
  })
})
