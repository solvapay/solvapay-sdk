/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { AutoRecharge } from './AutoRecharge'
import { SolvaPayProvider } from '../SolvaPayProvider'
import type { AutoRechargeConfig } from '@solvapay/server'

const config: AutoRechargeConfig = {
  enabled: true,
  trigger: { type: 'balance', thresholdCredits: 500 },
  topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
  rechargeCount: 0,
  status: 'active',
  failureCount: 0,
}

const autoRechargeMocks = vi.hoisted(() => ({
  config: null as AutoRechargeConfig | null,
  loading: false,
  saving: false,
  disabling: false,
  error: null as Error | null,
  save: vi.fn(),
  disable: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('../hooks/useAutoRecharge', () => ({
  useAutoRecharge: () => ({
    config: autoRechargeMocks.config,
    loading: autoRechargeMocks.loading,
    saving: autoRechargeMocks.saving,
    disabling: autoRechargeMocks.disabling,
    error: autoRechargeMocks.error,
    refresh: autoRechargeMocks.refresh,
    save: autoRechargeMocks.save,
    disable: autoRechargeMocks.disable,
  }),
}))

vi.mock('../hooks/useBalance', () => ({
  useBalance: () => ({
    creditsPerMinorUnit: 100,
    displayExchangeRate: 1,
    displayCurrency: 'USD',
  }),
}))

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="stripe-elements">{children}</div>
  ),
  useStripe: () => ({ confirmSetup: vi.fn().mockResolvedValue({ error: undefined }) }),
  useElements: () => ({ submit: vi.fn().mockResolvedValue({ error: undefined }) }),
  PaymentElement: () => <div data-testid="payment-element" />,
}))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}))

function renderAutoRecharge(
  props: Partial<React.ComponentProps<typeof AutoRecharge.Root>> = {},
  children?: React.ReactNode,
) {
  return render(
    <SolvaPayProvider config={{}}>
      <AutoRecharge.Root currency="USD" {...props}>
        {children ?? (
          <>
            <AutoRecharge.Loading />
            <AutoRecharge.Header />
            <AutoRecharge.Body />
            <AutoRecharge.Error />
            <AutoRecharge.StatusMessage />
          </>
        )}
      </AutoRecharge.Root>
    </SolvaPayProvider>,
  )
}

function enableAutoRecharge(): void {
  fireEvent.click(screen.getByLabelText('Enable auto-recharge'))
}

beforeEach(() => {
  autoRechargeMocks.config = null
  autoRechargeMocks.loading = false
  autoRechargeMocks.saving = false
  autoRechargeMocks.disabling = false
  autoRechargeMocks.error = null
  autoRechargeMocks.save.mockReset()
  autoRechargeMocks.disable.mockReset()
  autoRechargeMocks.refresh.mockReset()
})

describe('AutoRecharge primitive', () => {
  it('renders only the toggle when auto-recharge is off', () => {
    renderAutoRecharge()
    const toggle = screen.getByLabelText('Enable auto-recharge')
    expect(toggle).toBeInTheDocument()
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(/recommended for production/i)).toBeInTheDocument()
  })

  it('shows threshold and amount controls when enabled', () => {
    renderAutoRecharge({ defaultTopupAmountMajor: 25 })
    enableAutoRecharge()
    expect(screen.getByText('When balance falls below')).toBeInTheDocument()
    expect(screen.getByLabelText('Balance threshold')).toBeInTheDocument()
    expect(screen.getByLabelText('Fixed top-up amount')).toBeInTheDocument()
  })

  it('switches fill title between fixed amount and fill to target', () => {
    renderAutoRecharge()
    enableAutoRecharge()
    expect(screen.getByText('Add this amount')).toBeInTheDocument()
    expect(screen.getByLabelText('Fixed top-up amount')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Switch to fill to target'))
    expect(screen.getByText('Fill up to target')).toBeInTheDocument()
    expect(screen.getByLabelText('Target credits')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Switch to fixed amount'))
    expect(screen.getByText('Add this amount')).toBeInTheDocument()
  })

  it('shows balance threshold summary with natural phrasing', () => {
    renderAutoRecharge({ currency: 'SEK' })
    enableAutoRecharge()
    expect(
      screen.getByText(/When my balance falls below .* add .*./),
    ).toBeInTheDocument()
  })

  it('rejects invalid values inline before save', async () => {
    renderAutoRecharge()
    enableAutoRecharge()
    fireEvent.change(screen.getByLabelText('Fixed top-up amount'), { target: { value: '0.01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save automatic top-up' }))
    expect(autoRechargeMocks.save).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/minimum/i)
    })
  })

  it('calls save with validated payload on submit', async () => {
    autoRechargeMocks.save.mockResolvedValue({ config })
    renderAutoRecharge()
    enableAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save automatic top-up' }))
    })
    expect(autoRechargeMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        topupMode: 'fixed',
        thresholdAmountMajor: 5,
        topupAmountMajor: 10,
        currency: 'USD',
      }),
    )
  })

  it('shows disable button when config exists', () => {
    autoRechargeMocks.config = config
    renderAutoRecharge()
    expect(screen.getByRole('button', { name: 'Disable automatic top-up' })).toBeInTheDocument()
  })

  it('shows loading state', () => {
    autoRechargeMocks.loading = true
    renderAutoRecharge()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows hook error', () => {
    autoRechargeMocks.error = new Error('Failed to load auto-recharge: 500')
    renderAutoRecharge()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load auto-recharge: 500')
  })

  it('saves topupAmountMajor in currency when fixed amount unit is toggled to credits', async () => {
    autoRechargeMocks.save.mockResolvedValue({ config })
    renderAutoRecharge()
    enableAutoRecharge()
    fireEvent.click(screen.getByLabelText('Switch fixed top-up amount to credits'))
    fireEvent.change(screen.getByLabelText('Fixed top-up amount'), { target: { value: '100000' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save automatic top-up' }))
    })
    expect(autoRechargeMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ topupAmountMajor: 10 }),
    )
  })

  it('saves targetCredits when fill-to-target is entered in currency', async () => {
    autoRechargeMocks.save.mockResolvedValue({ config })
    renderAutoRecharge()
    enableAutoRecharge()
    fireEvent.click(screen.getByLabelText('Switch to fill to target'))
    fireEvent.change(screen.getByLabelText('Target credits'), { target: { value: '10' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save automatic top-up' }))
    })
    expect(autoRechargeMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ topupMode: 'target', targetCredits: 100_000 }),
    )
  })

  it('keeps fill-to-target unit when switching between fixed and target modes', () => {
    renderAutoRecharge()
    enableAutoRecharge()
    fireEvent.click(screen.getByLabelText('Switch to fill to target'))
    fireEvent.click(screen.getByLabelText('Switch target balance to credits'))
    expect(screen.getByLabelText('Switch target balance to currency')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Switch to fixed amount'))
    fireEvent.click(screen.getByLabelText('Switch to fill to target'))

    expect(screen.getByLabelText('Switch target balance to currency')).toBeInTheDocument()
  })

  it('defaults fill-to-target to currency like fixed amount', () => {
    renderAutoRecharge()
    enableAutoRecharge()
    fireEvent.click(screen.getByLabelText('Switch to fill to target'))
    expect(screen.getByLabelText('Switch target balance to credits')).toBeInTheDocument()
  })

  it('includes maxRecharges in save payload from advanced panel', async () => {
    autoRechargeMocks.save.mockResolvedValue({ config })
    renderAutoRecharge()
    enableAutoRecharge()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    fireEvent.change(screen.getByLabelText('Maximum recharges'), { target: { value: '3' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save automatic top-up' }))
    })
    expect(autoRechargeMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ maxRecharges: 3 }),
    )
  })

  it('shows card setup when save returns setupClientSecret', async () => {
    autoRechargeMocks.save.mockResolvedValue({
      config,
      setupClientSecret: 'seti_secret',
      publishableKey: 'pk_test',
    })
    renderAutoRecharge()
    enableAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save automatic top-up' }))
    })
    expect(screen.getByTestId('stripe-elements')).toBeInTheDocument()
    expect(screen.getByTestId('payment-element')).toBeInTheDocument()
  })

  it('shows status badge for pending_setup config', () => {
    autoRechargeMocks.config = { ...config, status: 'pending_setup' }
    render(
      <SolvaPayProvider config={{}}>
        <AutoRecharge.Root currency="USD">
          <AutoRecharge.Status />
        </AutoRecharge.Root>
      </SolvaPayProvider>,
    )
    expect(screen.getByText('Pending card authorization')).toBeInTheDocument()
  })
})
