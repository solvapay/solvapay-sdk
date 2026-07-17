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

describe('createTaxSummaryParts.Rows', () => {
  const inclusiveBreakdown: TaxBreakdown = {
    subtotal: 800,
    taxAmount: 200,
    taxRate: 0.25,
    treatment: 'standard',
    total: 1000,
    currency: 'EUR',
    inclusive: true,
  }

  it('renders Subtotal, VAT (25%, incl.), and Total labels in a dl', () => {
    const ctx = makeSummaryCtx({ taxBreakdown: inclusiveBreakdown })
    const { Rows } = createTaxSummaryParts(() => ctx, 'payment-form')

    const { container } = render(<Rows />)

    expect(screen.getByText('Subtotal')).toBeInTheDocument()
    expect(screen.getByText('VAT (25%, incl.)')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(container.querySelector('dl')).toBeTruthy()
    expect(container.querySelector('.solvapay-tax-summary-row--total')).toBeTruthy()
  })

  it('hides tax row when treatment is not_collecting', () => {
    const ctx = makeSummaryCtx({
      taxBreakdown: {
        ...inclusiveBreakdown,
        treatment: 'not_collecting',
        taxAmount: 0,
        taxRate: 0,
      },
    })
    const { Rows } = createTaxSummaryParts(() => ctx, 'payment-form')

    render(<Rows />)

    expect(screen.queryByText(/VAT/)).not.toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('renders nothing for consumer checkouts', () => {
    const ctx = makeSummaryCtx({
      isBusiness: false,
      taxBreakdown: inclusiveBreakdown,
    })
    const { Rows } = createTaxSummaryParts(() => ctx, 'payment-form')

    const { container } = render(<Rows />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('createTaxSummaryParts.Tax', () => {
  it('formats inclusive VAT label on the default Tax leaf', () => {
    const ctx = makeSummaryCtx({
      taxBreakdown: {
        subtotal: 800,
        taxAmount: 200,
        taxRate: 0.25,
        treatment: 'standard',
        total: 1000,
        currency: 'EUR',
        inclusive: true,
      },
    })
    const { Tax } = createTaxSummaryParts(() => ctx, 'payment-form')

    render(<Tax />)

    expect(screen.getByText('VAT (25%, incl.)')).toBeInTheDocument()
  })
})
