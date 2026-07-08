import { describe, it, expect } from 'vitest'
import {
  resolveSellerOrganizationNumberDisplay,
  resolveSellerTaxDisplay,
} from '../resolveSellerTaxDisplay'
import type { Merchant } from '../../../types'

const base: Merchant = {
  displayName: 'Acme AB',
  legalName: 'Acme AB',
  country: 'SE',
  companyNumber: '5561234567',
  vatNumber: 'SE556123456701',
}

describe('resolveSellerTaxDisplay', () => {
  it('uses the VAT number label for VAT-required countries', () => {
    expect(resolveSellerTaxDisplay(base)).toEqual({
      kind: 'provided',
      value: 'SE556123456701',
      label: 'VAT number',
    })
  })

  it('uses the core EIN label for US providers with a tax id', () => {
    expect(
      resolveSellerTaxDisplay({
        ...base,
        country: 'US',
        companyNumber: undefined,
        taxId: '12-3456789',
        vatNumber: undefined,
      }),
    ).toEqual({
      kind: 'provided',
      value: '12-3456789',
      label: 'EIN (Employer Identification Number)',
    })
  })

  it('falls back to the core tax id label for other supported countries', () => {
    expect(
      resolveSellerTaxDisplay({
        ...base,
        country: 'FR',
        companyNumber: undefined,
        taxId: 'FR-TAX-1',
        vatNumber: undefined,
      }),
    ).toEqual({
      kind: 'provided',
      value: 'FR-TAX-1',
      label: 'VAT ID',
    })
  })

  it('returns not_provided when no tax identifier is available', () => {
    expect(resolveSellerTaxDisplay({ ...base, vatNumber: undefined })).toEqual({
      kind: 'not_provided',
    })
  })

  it('returns not_provided for an unsupported country even with a tax id', () => {
    expect(
      resolveSellerTaxDisplay({
        ...base,
        country: 'JP',
        companyNumber: undefined,
        taxId: 'JP-TAX-1',
        vatNumber: undefined,
      }),
    ).toEqual({ kind: 'not_provided' })
  })

  it('returns not_provided when there is no merchant', () => {
    expect(resolveSellerTaxDisplay(null)).toEqual({ kind: 'not_provided' })
    expect(resolveSellerTaxDisplay(undefined)).toEqual({ kind: 'not_provided' })
  })
})

describe('resolveSellerOrganizationNumberDisplay', () => {
  it('prefers the company number over the tax id fallback', () => {
    const taxDisplay = resolveSellerTaxDisplay(base)
    expect(resolveSellerOrganizationNumberDisplay(base, taxDisplay)).toBe('5561234567')
  })

  it('hides the org line when it duplicates the tax row value', () => {
    const merchant: Merchant = {
      ...base,
      country: 'US',
      companyNumber: undefined,
      taxId: '12-3456789',
      vatNumber: undefined,
    }
    const taxDisplay = resolveSellerTaxDisplay(merchant)
    expect(resolveSellerOrganizationNumberDisplay(merchant, taxDisplay)).toBeNull()
  })

  it('falls back to the tax id when no company number is present', () => {
    const merchant: Merchant = {
      ...base,
      country: 'SE',
      companyNumber: undefined,
      taxId: '5561234567',
      vatNumber: 'SE556123456701',
    }
    const taxDisplay = resolveSellerTaxDisplay(merchant)
    expect(resolveSellerOrganizationNumberDisplay(merchant, taxDisplay)).toBe('5561234567')
  })

  it('returns null when neither company number nor tax id is present', () => {
    const taxDisplay = resolveSellerTaxDisplay(base)
    expect(
      resolveSellerOrganizationNumberDisplay(
        { ...base, companyNumber: undefined, taxId: undefined },
        taxDisplay,
      ),
    ).toBeNull()
  })
})
