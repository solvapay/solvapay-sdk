import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import type { AutoRechargeConfig, SaveAutoRechargeResponse } from '@solvapay/server'
import { McpAutoRechargeView } from '../McpAutoRechargeView'
import { merchantCache } from '../../../hooks/useMerchant'
import { autoRechargeCache } from '../../../hooks/autoRechargeCache'
import { SolvaPayContext } from '../../../SolvaPayProvider'
import { mockBalanceStatus } from '../../../test-helpers/mockBalanceStatus'
import type { Merchant, SolvaPayConfig, SolvaPayContextValue } from '../../../types'
import type { SolvaPayTransport } from '../../../transport/types'
import { createTransportCacheKey } from '../../../transport/cache-key'

const enabledConfig: AutoRechargeConfig = {
  enabled: true,
  trigger: { type: 'balance', thresholdAmountMinor: 500 },
  topup: { mode: 'fixed', amountMinor: 5000, currency: 'USD' },
  fundingSourceType: 'saved_card',
  paymentMethodId: 'pm_123',
  status: 'active',
  failureCount: 0,
  monthlySpendMinor: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
  display: {
    currency: 'USD',
    exchangeRate: 1,
    rateSource: 'parity',
    thresholdAmountMajor: 5,
    topupAmountMajor: 50,
    formatted: { threshold: '$5', topup: '$50' },
  },
}

function createTransport(overrides: Partial<SolvaPayTransport> = {}): SolvaPayTransport {
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
    getMerchant: vi.fn().mockResolvedValue({
      displayName: 'Acme',
      legalName: 'Acme Inc.',
      defaultCurrency: 'usd',
    } satisfies Merchant),
    listPlans: vi.fn().mockResolvedValue([]),
    getPaymentMethod: vi.fn().mockResolvedValue({ kind: 'none' }),
    getAutoRecharge: vi.fn().mockResolvedValue({ config: null }),
    saveAutoRecharge: vi.fn(),
    disableAutoRecharge: vi.fn(),
    ...overrides,
  }
}

function buildCtx(config: SolvaPayConfig): SolvaPayContextValue {
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
    balance: mockBalanceStatus({
      credits: 1000,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
    }),
    _config: config,
  }
}

function seedMerchant(config: SolvaPayConfig, merchant: Merchant): void {
  const key = createTransportCacheKey(config, '/api/merchant')
  merchantCache.set(key, { merchant, promise: null, timestamp: Date.now() })
}

function renderView(transport: SolvaPayTransport, onBack: () => void = vi.fn()) {
  const config: SolvaPayConfig = { transport }
  seedMerchant(config, {
    displayName: 'Acme',
    legalName: 'Acme Inc.',
    defaultCurrency: 'usd',
  })
  return render(
    <SolvaPayContext.Provider value={buildCtx(config)}>
      <McpAutoRechargeView onBack={onBack} />
    </SolvaPayContext.Provider>,
  )
}

beforeEach(() => {
  merchantCache.clear()
  autoRechargeCache.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('<McpAutoRechargeView>', () => {
  it('saves a turn-on payload without deferSetupIntent', async () => {
    const saveAutoRecharge = vi.fn().mockResolvedValue({
      config: enabledConfig,
    } satisfies SaveAutoRechargeResponse)
    const onBack = vi.fn()
    renderView(
      createTransport({
        saveAutoRecharge,
      }),
      onBack,
    )

    await screen.findByRole('button', { name: 'Turn on auto-recharge' })
    fireEvent.change(screen.getByLabelText('When balance falls below'), {
      target: { value: '5' },
    })
    fireEvent.change(screen.getByLabelText('Add each time'), {
      target: { value: '50' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Turn on auto-recharge' }))
    })

    expect(saveAutoRecharge).toHaveBeenCalledWith({
      enabled: true,
      triggerType: 'balance',
      thresholdAmountMajor: 5,
      topupAmountMajor: 50,
      currency: 'USD',
    })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('saves edits from an existing config', async () => {
    const saveAutoRecharge = vi.fn().mockResolvedValue({
      config: enabledConfig,
    } satisfies SaveAutoRechargeResponse)
    const onBack = vi.fn()
    renderView(
      createTransport({
        getAutoRecharge: vi.fn().mockResolvedValue({ config: enabledConfig }),
        saveAutoRecharge,
      }),
      onBack,
    )

    await screen.findByRole('button', { name: 'Save changes' })
    expect(screen.getByText('On')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Add each time'), {
      target: { value: '25' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    })

    expect(saveAutoRecharge).toHaveBeenCalledWith({
      enabled: true,
      triggerType: 'balance',
      thresholdAmountMajor: 5,
      topupAmountMajor: 25,
      currency: 'USD',
    })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('turns auto-recharge off from the quiet link', async () => {
    const disableAutoRecharge = vi.fn().mockResolvedValue({ success: true })
    const onBack = vi.fn()
    renderView(
      createTransport({
        getAutoRecharge: vi.fn().mockResolvedValue({ config: enabledConfig }),
        disableAutoRecharge,
      }),
      onBack,
    )

    await screen.findByRole('button', { name: 'Turn off auto-recharge' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Turn off auto-recharge' }))
    })

    expect(disableAutoRecharge).toHaveBeenCalledTimes(1)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('stays put and shows the validation error', async () => {
    const saveAutoRecharge = vi.fn()
    renderView(createTransport({ saveAutoRecharge }))

    await screen.findByRole('button', { name: 'Turn on auto-recharge' })
    fireEvent.change(screen.getByLabelText('When balance falls below'), {
      target: { value: '' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Turn on auto-recharge' }))
    })

    expect(saveAutoRecharge).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/threshold/i)
    expect(screen.getByRole('button', { name: 'Turn on auto-recharge' })).toBeTruthy()
  })

  it('fails loudly when the server returns a setupClientSecret', async () => {
    const saveAutoRecharge = vi.fn().mockResolvedValue({
      config: { ...enabledConfig, status: 'pending_setup' },
      setupClientSecret: 'seti_secret',
    } satisfies SaveAutoRechargeResponse)
    const onBack = vi.fn()
    renderView(createTransport({ saveAutoRecharge }), onBack)

    await screen.findByRole('button', { name: 'Turn on auto-recharge' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Turn on auto-recharge' }))
    })

    expect(onBack).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/no longer reusable/i)
    expect(screen.queryByText(/Authorize card/)).toBeNull()
  })

  it('does not render a card form', async () => {
    renderView(createTransport())
    await screen.findByRole('button', { name: 'Turn on auto-recharge' })
    expect(screen.queryByText(/Continue to payment/)).toBeNull()
    expect(document.querySelector('[data-solvapay-auto-recharge]')).toBeNull()
  })
})
