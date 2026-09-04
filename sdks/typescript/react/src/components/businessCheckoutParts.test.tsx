/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import {
  createBusinessDetailsParts,
  createTaxSummaryParts,
  type BusinessDetailsContextSlice,
  type TaxSummaryContextSlice,
} from './businessCheckoutParts'
import type { TaxBreakdown } from '@solvapay/core'

function makeBusinessCtx(
  overrides?: Partial<BusinessDetailsContextSlice>,
): BusinessDetailsContextSlice {
  return {
    businessDetails: { isBusiness: false },
    setBusinessDetails: vi.fn(),
    fieldErrors: {},
    ...overrides,
  }
}

function makeSummaryCtx(overrides?: Partial<TaxSummaryContextSlice>): TaxSummaryContextSlice {
  return {
    taxBreakdown: null,
    businessDetailsAttaching: false,
    baseAmountMinor: 1000,
    currency: 'usd',
    isBusiness: true,
    ...overrides,
  }
}

describe('createBusinessDetailsParts.Fields', () => {
  it('renders toggle label and hides business inputs when not purchasing as business', () => {
    let ctx = makeBusinessCtx()
    const useCtx = () => ctx
    const { Fields } = createBusinessDetailsParts(useCtx, 'payment-form')

    const { rerender } = render(<Fields />)

    expect(screen.getByText("I'm purchasing as a business")).toBeInTheDocument()
    expect(screen.queryByText('Business name')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Acme GmbH')).not.toBeInTheDocument()

    ctx = makeBusinessCtx({
      businessDetails: { isBusiness: true, businessName: '', country: '', taxId: '' },
    })
    rerender(<Fields />)

    expect(screen.getByText('Business name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Acme GmbH')).toBeInTheDocument()
    expect(screen.getByText('Country')).toBeInTheDocument()
    expect(screen.getByText('Tax ID')).toBeInTheDocument()
  })

  it('uses dynamic tax id label for selected country', () => {
    const ctx = makeBusinessCtx({
      businessDetails: { isBusiness: true, businessName: '', country: 'GB', taxId: '' },
    })
    const { Fields } = createBusinessDetailsParts(() => ctx, 'payment-form')

    render(<Fields />)

    expect(screen.getByText('VAT Number')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('GB123456789')).toBeInTheDocument()
  })

  it('shows full country names instead of ISO codes in the Country dropdown', () => {
    const ctx = makeBusinessCtx({
      businessDetails: { isBusiness: true, businessName: '', country: '', taxId: '' },
    })
    const { Fields } = createBusinessDetailsParts(() => ctx, 'payment-form')

    render(<Fields />)

    const countrySelect = screen.getByRole('combobox', { name: /country/i })
    expect(countrySelect).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Germany' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'United Kingdom' })).toBeInTheDocument()

    const optionTexts = Array.from(countrySelect.querySelectorAll('option'))
      .map(option => option.textContent)
      .filter(text => text !== 'Select country')
    expect(optionTexts).not.toContain('DE')
    expect(optionTexts).not.toContain('GB')
  })

  it('uses semantic fieldset for business inputs', () => {
    const ctx = makeBusinessCtx({
      businessDetails: { isBusiness: true, businessName: 'Acme', country: 'DE', taxId: '' },
    })
    const { Fields } = createBusinessDetailsParts(() => ctx, 'payment-form')

    const { container } = render(<Fields />)

    expect(container.querySelector('fieldset.solvapay-business-fields')).toBeTruthy()
    expect(container.querySelectorAll('.solvapay-business-field-label').length).toBeGreaterThan(0)
  })
})

describe('createTaxSummaryParts — DEV-723 buyer-facing tax copy', () => {
  const base: TaxBreakdown = {
    subtotal: 9000,
    taxAmount: 0,
    taxRate: 0,
    treatment: 'none',
    total: 9000,
    currency: 'USD',
    inclusive: false,
  }

  function renderRows(breakdown: TaxBreakdown, ctxOverrides?: Partial<TaxSummaryContextSlice>) {
    const ctx = makeSummaryCtx({ taxBreakdown: breakdown, ...ctxOverrides })
    const { Rows } = createTaxSummaryParts(() => ctx, 'payment-form')
    return render(<Rows />)
  }

  describe('a zero tax amount is an amount, never "Free"', () => {
    it('renders $0 for an exclusive zero-VAT sale', () => {
      renderRows(base)

      expect(screen.queryByText('Free')).not.toBeInTheDocument()
      expect(screen.getByText('VAT')).toBeInTheDocument()
      expect(screen.getByText('$0')).toBeInTheDocument()
    })

    it('renders $0 for a reverse-charge sale', () => {
      renderRows({ ...base, treatment: 'reverse_charge' })

      expect(screen.getByText('VAT (reverse charge)')).toBeInTheDocument()
      expect(screen.queryByText('Free')).not.toBeInTheDocument()
      expect(screen.getByText('$0')).toBeInTheDocument()
    })

    it('renders $0 for a zero subtotal and total', () => {
      renderRows({ ...base, subtotal: 0, total: 0 }, { baseAmountMinor: 0 })

      expect(screen.queryByText('Free')).not.toBeInTheDocument()
      expect(screen.getAllByText('$0').length).toBe(3)
    })

    it('renders $0 on the standalone Tax leaf', () => {
      const ctx = makeSummaryCtx({ taxBreakdown: base })
      const { Tax } = createTaxSummaryParts(() => ctx, 'payment-form')

      render(<Tax />)

      expect(screen.queryByText('Free')).not.toBeInTheDocument()
      expect(screen.getByText('$0')).toBeInTheDocument()
    })
  })

  describe('included vs excluded VAT reads the same to the buyer', () => {
    const exclusive: TaxBreakdown = {
      subtotal: 7200,
      taxAmount: 1800,
      taxRate: 0.25,
      treatment: 'standard',
      total: 9000,
      currency: 'EUR',
      inclusive: false,
    }

    it('labels the subtotal as net and the VAT with a bare rate when tax is added on top', () => {
      renderRows(exclusive)

      expect(screen.getByText('Subtotal (excl. VAT)')).toBeInTheDocument()
      expect(screen.getByText('VAT (25%)')).toBeInTheDocument()
      expect(screen.getByText('Total')).toBeInTheDocument()
    })

    it('renders identical labels when the same tax is included in the price', () => {
      renderRows({ ...exclusive, inclusive: true })

      expect(screen.getByText('Subtotal (excl. VAT)')).toBeInTheDocument()
      expect(screen.getByText('VAT (25%)')).toBeInTheDocument()
      // The `incl.` marker is gone on purpose: the rows themselves now say
      // which amount is net and which is gross, in both directions.
      expect(screen.queryByText('VAT (25%, incl.)')).not.toBeInTheDocument()
      expect(screen.queryByText('VAT (25%, excl.)')).not.toBeInTheDocument()
    })
  })

  describe('no-tax-assessed treatments drop the row and explain instead', () => {
    it.each(['not_collecting', 'not_supported'] as const)(
      'replaces the VAT row with a note for %s',
      treatment => {
        renderRows({ ...base, treatment })

        expect(screen.queryByText(/VAT/)).not.toBeInTheDocument()
        expect(screen.getByText('Tax is not collected on this purchase.')).toBeInTheDocument()
        // With no VAT row there is nothing to be exclusive of.
        expect(screen.getByText('Subtotal')).toBeInTheDocument()
        expect(screen.getByText('Total')).toBeInTheDocument()
      },
    )

    it.each(['not_collecting', 'not_supported'] as const)(
      'hides the standalone Tax leaf for %s',
      treatment => {
        const ctx = makeSummaryCtx({ taxBreakdown: { ...base, treatment } })
        const { Tax } = createTaxSummaryParts(() => ctx, 'payment-form')

        const { container } = render(<Tax />)

        expect(container).toBeEmptyDOMElement()
      },
    )

    it('explains reverse charge under the rows', () => {
      renderRows({ ...base, treatment: 'reverse_charge' })

      expect(
        screen.getByText(
          'VAT reverse charge applies — you are responsible for reporting VAT in your jurisdiction.',
        ),
      ).toBeInTheDocument()
    })
  })

  describe('structure', () => {
    it('renders a definition list with a total row', () => {
      const { container } = renderRows(base)

      expect(container.querySelector('dl')).toBeTruthy()
      expect(container.querySelector('.solvapay-tax-summary-row--total')).toBeTruthy()
      // dt/dd must be direct children of dl or a div — never of a <p>.
      expect(container.querySelector('p dt')).toBeNull()
    })

    it('renders nothing for consumer checkouts', () => {
      const ctx = makeSummaryCtx({ isBusiness: false, taxBreakdown: base })
      const { Rows } = createTaxSummaryParts(() => ctx, 'payment-form')

      const { container } = render(<Rows />)

      expect(container).toBeEmptyDOMElement()
    })
  })
})
