/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import type { TaxBreakdown } from '@solvapay/core'
import { PaymentForm } from './PaymentForm'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue } from '../types'
import { mockBalanceStatus } from '../test-helpers/mockBalanceStatus'

const attachHookMock = vi.hoisted(() => ({
  runAttach: vi.fn().mockResolvedValue(true),
  setBusinessDetails: vi.fn(),
}))

vi.mock('../hooks/useBusinessDetailsAttach', () => ({
  defaultBusinessDetails: { isBusiness: false },
  useBusinessDetailsAttach: vi.fn(() => ({
    businessDetails: { isBusiness: false, customerCountry: 'SE' },
    setBusinessDetails: attachHookMock.setBusinessDetails,
    fieldErrors: {},
    taxBreakdown: null,
    businessDetailsAttached: true,
    businessDetailsAttaching: false,
    businessDetailsError: null,
    requiresBusinessAttach: true,
    runAttach: attachHookMock.runAttach,
  })),
}))

const mockTaxBreakdown: TaxBreakdown = {
  subtotal: 1000,
  taxAmount: 0,
  taxRate: 0,
  treatment: 'none',
  total: 1000,
  currency: 'usd',
  inclusive: false,
}

vi.mock('../vault/CardFields', () => ({
  VaultCardFields: () => React.createElement('div', { 'data-testid': 'card-fields' }),
}))

vi.mock('../hooks/usePlan', () => ({
  usePlan: () => ({
    plan: {
      reference: 'pln_test',
      name: 'Pro',
      price: 1000,
      currency: 'usd',
      requiresPayment: true,
      type: 'recurring',
      interval: 'month',
    },
    loading: false,
    error: null,
  }),
}))

vi.mock('../hooks/useCheckout', () => ({
  useCheckout: () => ({
    loading: false,
    error: null,
    paymentIntentId: 'pi_sp_test',
    vault: { tenantId: 'tntr4ol0cbq', environment: 'sandbox' },
    processorPaymentId: null,
    resolvedPlanRef: 'pln_test',
    startCheckout: vi.fn(),
    reset: vi.fn(),
  }),
}))

vi.mock('../hooks/useProduct', () => ({
  useProduct: () => ({ product: { name: 'API' }, loading: false, error: null }),
}))

vi.mock('../hooks/usePurchase', () => ({
  usePurchase: () => ({ refetch: vi.fn().mockResolvedValue(undefined) }),
}))

vi.mock('../hooks/useCustomer', () => ({
  useCustomer: () => ({ email: 'test@example.com', name: 'Test User' }),
}))

function ctx(overrides?: Partial<SolvaPayContextValue>): SolvaPayContextValue {
  return {
    purchase: {
      loading: false,
      isRefetching: false,
      error: null,
      purchases: [],
      hasProduct: () => false,
      activePurchase: null,
      hasPaidPurchase: false,
      activePaidPurchase: null,
      balanceTransactions: [],
    },
    refetchPurchase: vi.fn().mockResolvedValue(undefined),
    upsertPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    processPayment: vi.fn().mockResolvedValue({ status: 'succeeded', type: 'recurring' }),
    createCaptureGrant: vi.fn(),
    confirmPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: mockBalanceStatus(),
    _config: undefined,
    ...overrides,
  }
}

function Wrap({
  value,
  children,
}: {
  value: SolvaPayContextValue
  children: React.ReactNode
}) {
  return React.createElement(SolvaPayContext.Provider, { value }, children)
}

describe('PaymentForm business details + tax summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    attachHookMock.runAttach.mockResolvedValue(true)
  })

  it('wires processorPaymentId and attach transport into useBusinessDetailsAttach', async () => {
    const attachBusinessDetails = vi.fn().mockResolvedValue({ taxBreakdown: mockTaxBreakdown })
    const { useBusinessDetailsAttach } = await import('../hooks/useBusinessDetailsAttach')

    render(
      <Wrap value={ctx({ attachBusinessDetails })}>
        <PaymentForm.Root planRef="pln_test" productRef="prd_test">
          <PaymentForm.CardFields />
          <PaymentForm.SubmitButton data-testid="submit" />
        </PaymentForm.Root>
      </Wrap>,
    )

    await waitFor(() => expect(useBusinessDetailsAttach).toHaveBeenCalled())
    expect(useBusinessDetailsAttach).toHaveBeenCalledWith(
      expect.objectContaining({
        processorPaymentId: 'pi_sp_test',
        attachBusinessDetails,
      }),
    )
  })

  it('renders business details toggle with semantic section wrapper', async () => {
    render(
      <Wrap value={ctx({ attachBusinessDetails: vi.fn() })}>
        <PaymentForm.Root planRef="pln_test" productRef="prd_test">
          <PaymentForm.BusinessDetails.Root data-testid="business-root">
            <PaymentForm.BusinessDetails.Toggle data-testid="business-toggle" />
          </PaymentForm.BusinessDetails.Root>
        </PaymentForm.Root>
      </Wrap>,
    )

    await waitFor(() => expect(screen.getByTestId('business-root')).toBeTruthy())
    expect(screen.getByTestId('business-root').tagName).toBe('SECTION')
    expect(screen.getByTestId('business-toggle')).toBeTruthy()
  })

  it('exposes BusinessDetails.Fields with labeled business inputs when toggled on', async () => {
    const { useBusinessDetailsAttach } = await import('../hooks/useBusinessDetailsAttach')
    vi.mocked(useBusinessDetailsAttach).mockReturnValue({
      businessDetails: { isBusiness: true, businessName: '', country: 'SE', taxId: '' },
      setBusinessDetails: attachHookMock.setBusinessDetails,
      fieldErrors: {},
      taxBreakdown: null,
      businessDetailsAttached: true,
      businessDetailsAttaching: false,
      businessDetailsError: null,
      requiresBusinessAttach: true,
      runAttach: attachHookMock.runAttach,
    })

    render(
      <Wrap value={ctx({ attachBusinessDetails: vi.fn() })}>
        <PaymentForm.Root planRef="pln_test" productRef="prd_test">
          <PaymentForm.BusinessDetails.Root>
            <PaymentForm.BusinessDetails.Fields />
          </PaymentForm.BusinessDetails.Root>
        </PaymentForm.Root>
      </Wrap>,
    )

    await waitFor(() => expect(screen.getByText('Business name')).toBeInTheDocument())
    expect(screen.getByText('VAT ID')).toBeInTheDocument()
    expect(screen.getByText('Country')).toBeInTheDocument()
  })

  it('hides TaxSummary.Rows for consumer checkouts even when tax breakdown exists', async () => {
    const { useBusinessDetailsAttach } = await import('../hooks/useBusinessDetailsAttach')
    vi.mocked(useBusinessDetailsAttach).mockReturnValue({
      businessDetails: { isBusiness: false },
      setBusinessDetails: attachHookMock.setBusinessDetails,
      fieldErrors: {},
      taxBreakdown: {
        subtotal: 800,
        taxAmount: 200,
        taxRate: 0.25,
        treatment: 'standard',
        total: 1000,
        currency: 'EUR',
        inclusive: true,
      },
      businessDetailsAttached: true,
      businessDetailsAttaching: false,
      businessDetailsError: null,
      requiresBusinessAttach: true,
      runAttach: attachHookMock.runAttach,
    })

    render(
      <Wrap value={ctx({ attachBusinessDetails: vi.fn() })}>
        <PaymentForm.Root planRef="pln_test" productRef="prd_test">
          <PaymentForm.TaxSummary.Root>
            <PaymentForm.TaxSummary.Rows />
          </PaymentForm.TaxSummary.Root>
        </PaymentForm.Root>
      </Wrap>,
    )

    await waitFor(() => {
      expect(screen.queryByText('Total')).not.toBeInTheDocument()
      expect(screen.queryByText('Subtotal')).not.toBeInTheDocument()
    })
  })

  it('exposes TaxSummary.Rows with Total label and VAT copy for business checkouts', async () => {
    const { useBusinessDetailsAttach } = await import('../hooks/useBusinessDetailsAttach')
    vi.mocked(useBusinessDetailsAttach).mockReturnValue({
      businessDetails: {
        isBusiness: true,
        businessName: 'Acme GmbH',
        country: 'DE',
        taxId: 'DE123456789',
      },
      setBusinessDetails: attachHookMock.setBusinessDetails,
      fieldErrors: {},
      taxBreakdown: {
        subtotal: 800,
        taxAmount: 200,
        taxRate: 0.25,
        treatment: 'standard',
        total: 1000,
        currency: 'EUR',
        inclusive: true,
      },
      businessDetailsAttached: true,
      businessDetailsAttaching: false,
      businessDetailsError: null,
      requiresBusinessAttach: true,
      runAttach: attachHookMock.runAttach,
    })

    render(
      <Wrap value={ctx({ attachBusinessDetails: vi.fn() })}>
        <PaymentForm.Root planRef="pln_test" productRef="prd_test">
          <PaymentForm.TaxSummary.Root>
            <PaymentForm.TaxSummary.Rows />
          </PaymentForm.TaxSummary.Root>
        </PaymentForm.Root>
      </Wrap>,
    )

    await waitFor(() => expect(screen.getByText('Total')).toBeInTheDocument())
    // DEV-723: included and excluded VAT read identically — the subtotal row
    // says which amount is net, so the label carries no incl./excl. marker.
    expect(screen.getByText('VAT (25%)')).toBeInTheDocument()
    expect(screen.getByText('Subtotal (excl. VAT)')).toBeInTheDocument()
  })
})
