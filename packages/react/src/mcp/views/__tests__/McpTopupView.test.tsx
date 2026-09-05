/**
 * `<McpTopupView>` — multi-currency topup picker.
 *
 * The "Add credits" surface (the `topup` MCP tool) lets the customer
 * choose which currency to pay a credit topup in when the merchant
 * enables more than one. Credits stay USD-normalized, so the picker
 * only affects the Stripe PaymentIntent currency. Single-currency
 * merchants see no picker (today's behavior).
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'

vi.mock('../../../primitives/TopupForm', () => {
  const Root: React.FC<{
    currency?: string
    onSuccess?: () => void
    children?: React.ReactNode
  }> = ({ currency, onSuccess, children }) => (
    <section data-testid="topup-form-stub" data-currency={currency}>
      <button type="button" data-testid="topup-form-submit" onClick={() => onSuccess?.()}>
        submit topup
      </button>
      {children}
    </section>
  )
  const Loading: React.FC = () => null
  const PaymentElement: React.FC = () => null
  const ErrorSlot: React.FC = () => null
  const SubmitButton: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
    <span data-testid="topup-submit">{children}</span>
  )
  const BusinessDetails = {
    Root: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Toggle: () => null,
    BusinessName: () => null,
    Country: () => null,
    TaxId: () => null,
    Fields: () => null,
  }
  const Summary = {
    Root: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Subtotal: () => null,
    Tax: () => null,
    Total: () => null,
    Rows: () => null,
  }
  return { TopupForm: { Root, Loading, PaymentElement, Error: ErrorSlot, SubmitButton, BusinessDetails, Summary } }
})

vi.mock('../../../primitives/MandateText', () => ({ MandateText: () => null }))
vi.mock('../../useStripeProbe', () => ({ useStripeProbe: () => 'ready' }))

import { McpTopupView } from '../McpTopupView'
import { McpBridgeProvider, type McpBridgeAppLike } from '../../bridge'
import { McpDisplayModeProvider } from '../../hooks/useDisplayMode'
import { merchantCache } from '../../../hooks/useMerchant'
import { SolvaPayContext } from '../../../SolvaPayProvider'
import type { Merchant, SolvaPayConfig, SolvaPayContextValue } from '../../../types'
import type { SolvaPayTransport } from '../../../transport/types'

function createMockTransport(merchant: Merchant): SolvaPayTransport {
  return {
    checkPurchase: vi.fn().mockResolvedValue({ purchases: [] }),
    createPayment: vi.fn(),
    processPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    createCheckoutSession: vi.fn(),
    createCustomerSession: vi.fn(),
    getMerchant: vi.fn().mockResolvedValue(merchant),
    listPlans: vi.fn().mockResolvedValue([]),
    getPaymentMethod: vi.fn().mockResolvedValue({ kind: 'none' }),
  }
}

function buildCtx(config: SolvaPayConfig, displayCurrency = 'USD'): SolvaPayContextValue {
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
      customerRef: 'cus_test',
      email: 'demo@acme.test',
      name: 'Demo',
    },
    refetchPurchase: vi.fn(),
    upsertPurchase: vi.fn(),
    createPayment: vi.fn(),
    createTopupPayment: vi.fn(),
    cancelRenewal: vi.fn(),
    reactivateRenewal: vi.fn(),
    activatePlan: vi.fn(),
    balance: {
      loading: false,
      credits: 1000,
      displayCurrency,
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
      display: null,
      refetch: vi.fn(),
      adjustBalance: vi.fn(),
      reconcileAfterUsageDebit: vi.fn(),
    },
    _config: config,
  }
}

function renderTopup(
  merchant: Merchant,
  displayCurrency = 'USD',
  displayMode: 'inline' | 'fullscreen' = 'inline',
) {
  const transport = createMockTransport(merchant)
  const config: SolvaPayConfig = { transport }
  const ctx = buildCtx(config, displayCurrency)
  const app: McpBridgeAppLike = { updateModelContext: vi.fn().mockResolvedValue(undefined) }
  return render(
    <SolvaPayContext.Provider value={ctx}>
      <McpDisplayModeProvider
        value={{ displayMode, availableDisplayModes: ['inline', 'fullscreen'] }}
      >
        <McpBridgeProvider app={app}>
          <McpTopupView publishableKey="pk_test" returnUrl="https://example.test/r" />
        </McpBridgeProvider>
      </McpDisplayModeProvider>
    </SolvaPayContext.Provider>,
  )
}

const multiCurrencyMerchant: Merchant = {
  displayName: 'Acme',
  legalName: 'Acme Inc.',
  defaultCurrency: 'usd',
  supportedTopupCurrencies: ['usd', 'eur', 'gbp'],
}

const singleCurrencyMerchant: Merchant = {
  displayName: 'Acme',
  legalName: 'Acme Inc.',
  defaultCurrency: 'sek',
}

const singleCurrencyUsdMerchant: Merchant = {
  displayName: 'Acme',
  legalName: 'Acme Inc.',
  defaultCurrency: 'usd',
}

beforeEach(() => {
  merchantCache.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('<McpTopupView> — topup currency picker', () => {
  it('renders a currency switcher with the full supported set for multi-currency merchants', async () => {
    renderTopup(multiCurrencyMerchant)
    const select = (await screen.findByLabelText('Topup currency')) as HTMLSelectElement
    expect(select.value).toBe('USD')
    expect(Array.from(select.options).map(o => o.value)).toEqual(['USD', 'EUR', 'GBP'])
  })

  it('omits the switcher for single-currency merchants', async () => {
    renderTopup(singleCurrencyMerchant)
    await screen.findByText('Add credits')
    expect(screen.queryByLabelText('Topup currency')).toBeNull()
  })

  it('threads the chosen currency into the topup PaymentIntent', async () => {
    renderTopup(multiCurrencyMerchant)
    const select = (await screen.findByLabelText('Topup currency')) as HTMLSelectElement
    act(() => {
      fireEvent.change(select, { target: { value: 'EUR' } })
    })
    await waitFor(() => expect(select.value).toBe('EUR'))

    const customInput = screen.getByPlaceholderText('0.00')
    act(() => {
      fireEvent.change(customInput, { target: { value: '25' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })

    const form = await screen.findByTestId('topup-form-stub')
    expect(form.getAttribute('data-currency')).toBe('EUR')
  })

  it('renders currency codes in amount pills when the switcher is shown', async () => {
    const { container } = renderTopup(multiCurrencyMerchant)
    await screen.findByLabelText('Topup currency')
    const pill = container.querySelector('[data-amount="10"]')
    expect(pill?.textContent?.replace(/\u00A0/g, ' ')).toMatch(/USD 10/)
    expect(pill?.textContent).not.toMatch(/^\$/)
  })

  it('shows currency code prefix in custom amount row when switcher is shown', async () => {
    const { container } = renderTopup(multiCurrencyMerchant)
    const select = (await screen.findByLabelText('Topup currency')) as HTMLSelectElement
    act(() => {
      fireEvent.change(select, { target: { value: 'GBP' } })
    })
    await waitFor(() => expect(select.value).toBe('GBP'))
    expect(container.querySelector('.solvapay-mcp-amount-currency-symbol')?.textContent).toBe('GBP')
  })

  it('keeps currency symbols in amount pills for single-currency merchants', async () => {
    renderTopup(singleCurrencyUsdMerchant)
    await screen.findByText('Add credits')
    const ten = document.querySelector('[data-amount="10"]')
    expect(ten?.textContent?.replace(/\u00A0/g, ' ')).toMatch(/\$10/)
    expect(ten?.textContent).not.toMatch(/USD 10/)
    expect(screen.queryByRole('button', { name: /^USD 10/ })).toBeNull()
  })

  it('preserves the entered amount when returning via Change amount', async () => {
    renderTopup(singleCurrencyUsdMerchant)
    await screen.findByText('Add credits')
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })
    await screen.findByTestId('topup-form-stub')
    fireEvent.click(screen.getByRole('button', { name: /Change amount/i }))
    await screen.findByText('Add credits')
    expect((screen.getByPlaceholderText('0.00') as HTMLInputElement).value).toBe('25')
  })

  it('renders preset tiles with the credits they buy', async () => {
    const { container } = renderTopup(singleCurrencyUsdMerchant)
    await screen.findByText('Add credits')
    const tile = container.querySelector('.solvapay-mcp-preset-tile')
    expect(tile).toBeTruthy()
    expect(tile?.textContent).toMatch(/100K credits/)
    expect(screen.getByText('Total due today')).toBeTruthy()
  })

  it('leads the fullscreen amount step with a summary rail', async () => {
    const { container } = renderTopup(singleCurrencyUsdMerchant, 'USD', 'fullscreen')
    await screen.findByText('Add credits')
    expect(container.querySelector('.solvapay-mcp-summary-rail')).toBeTruthy()
    expect(container.querySelector('.solvapay-mcp-hosted-layout')?.getAttribute('data-rail')).toBe(
      'hosted',
    )
  })

  it('leads the payment step with a summary rail before the card form', async () => {
    const { container } = renderTopup(singleCurrencyUsdMerchant)
    await screen.findByText('Add credits')
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '25' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    })
    await screen.findByTestId('topup-form-stub')
    const rail = container.querySelector('.solvapay-mcp-summary-rail')
    const action = container.querySelector('.solvapay-mcp-hosted-body')
    expect(rail).toBeTruthy()
    expect(action).toBeTruthy()
    expect(rail?.textContent).toMatch(/\$25/)
    expect(
      rail && action && (rail.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBeTruthy()
  })
})
