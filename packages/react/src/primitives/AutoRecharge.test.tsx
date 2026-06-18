/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { AutoRecharge } from './AutoRecharge'
import { AutoRecharge as AutoRechargeComponent } from '../components/AutoRecharge'
import { SolvaPayProvider } from '../SolvaPayProvider'
import type { AutoRechargeConfig } from '@solvapay/server'

const config: AutoRechargeConfig = {
  enabled: true,
  trigger: { type: 'balance', thresholdCredits: 500 },
  topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
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

function renderModalAutoRecharge(
  props: Partial<React.ComponentProps<typeof AutoRecharge.Root>> = {},
) {
  return render(
    <SolvaPayProvider config={{}}>
      <AutoRecharge.Root currency="USD" {...props}>
        <AutoRecharge.Trigger />
        <AutoRecharge.Content>
          <AutoRecharge.Title />
          <AutoRecharge.EnableQuestion />
          <AutoRecharge.EnableRow />
        <AutoRecharge.Fields>
          <AutoRecharge.ThresholdField />
          <AutoRecharge.TopupField />
          <AutoRecharge.ValidationError />
        </AutoRecharge.Fields>
        <AutoRecharge.Actions>
          <AutoRecharge.CancelButton />
          <AutoRecharge.SaveButton />
        </AutoRecharge.Actions>
        </AutoRecharge.Content>
      </AutoRecharge.Root>
    </SolvaPayProvider>,
  )
}

function openModal(): void {
  fireEvent.click(screen.getByRole('button', { name: /set up auto-recharge|modify/i }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
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
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    expect(autoRechargeMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        thresholdAmountMajor: 5,
        topupAmountMajor: 10,
        currency: 'USD',
      }),
    )
  })

  it('shows disable button when config exists', () => {
    autoRechargeMocks.config = config
    renderAutoRecharge({}, (
      <>
        <AutoRecharge.Header />
        <AutoRecharge.Body>
          <AutoRecharge.Actions>
            <AutoRecharge.SaveButton />
            <AutoRecharge.DisableButton />
          </AutoRecharge.Actions>
        </AutoRecharge.Body>
      </>
    ))
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
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    expect(autoRechargeMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ topupAmountMajor: 10 }),
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
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    expect(screen.getByTestId('stripe-elements')).toBeInTheDocument()
    expect(screen.getByTestId('payment-element')).toBeInTheDocument()
  })

  it('with deferCardSetup, save exposes pending config without SetupIntent UI', async () => {
    const onPendingConfig = vi.fn()
    renderModalAutoRecharge({ deferCardSetup: true, onPendingConfig })
    openModal()
    enableAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    expect(autoRechargeMocks.save).not.toHaveBeenCalled()
    expect(onPendingConfig).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, topupAmountMajor: 10 }),
    )
    expect(screen.queryByTestId('stripe-elements')).not.toBeInTheDocument()
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

describe('AutoRecharge modal flow', () => {
  it('opens dialog from trigger and shows settings title', () => {
    renderModalAutoRecharge()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    openModal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Auto recharge settings')).toBeInTheDocument()
  })

  it('shows checkbox enable control and question in the dialog', () => {
    renderModalAutoRecharge()
    openModal()
    expect(screen.getByText('Would you like to set up automatic recharge?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Yes, automatically recharge my card when my credit balance falls below a threshold',
      ),
    ).toBeInTheDocument()
    const checkbox = screen.getByLabelText('Enable auto-recharge')
    expect(checkbox).toHaveAttribute('data-appearance', 'checkbox')
    expect(checkbox).not.toBeChecked()
    expect(screen.queryByLabelText('Balance threshold')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('shows Cancel and Save settings buttons right-aligned in actions', () => {
    renderModalAutoRecharge()
    openModal()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    enableAutoRecharge()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeInTheDocument()
  })

  it('closes dialog on Cancel without saving', async () => {
    renderModalAutoRecharge()
    openModal()
    enableAutoRecharge()
    fireEvent.change(screen.getByLabelText('Fixed top-up amount'), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(autoRechargeMocks.save).not.toHaveBeenCalled()
    openModal()
    enableAutoRecharge()
    expect(screen.getByLabelText('Fixed top-up amount')).toHaveValue('10')
  })

  it('closes dialog after successful save', async () => {
    autoRechargeMocks.save.mockResolvedValue({ config })
    renderModalAutoRecharge()
    openModal()
    enableAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('shows Modify trigger when config exists', () => {
    autoRechargeMocks.config = config
    render(
      <SolvaPayProvider config={{}}>
        <AutoRechargeComponent currency="USD" />
      </SolvaPayProvider>,
    )
    expect(screen.getByRole('button', { name: 'Modify' })).toBeInTheDocument()
  })
})
