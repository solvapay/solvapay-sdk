/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { AutoRecharge } from './AutoRecharge'
import { AutoRecharge as AutoRechargeComponent } from '../components/AutoRecharge'
import { SolvaPayProvider } from '../SolvaPayProvider'
import { enCopy } from '../i18n/en'
import { interpolate } from '../i18n/interpolate'
import { formatPrice } from '../utils/format'
import type { AutoRechargeConfig } from '@solvapay/server'
import { makeProviderInitial } from '../test-helpers/makeProviderInitial'

const config: AutoRechargeConfig = {
  enabled: true,
  trigger: { type: 'balance', thresholdAmountMinor: 500 },
  topup: { mode: 'fixed', amountMinor: 1000, currency: 'USD' },
  fundingSourceType: 'saved_card',
  status: 'active',
  failureCount: 0,
  monthlySpendMinor: 0,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const autoRechargeMocks = vi.hoisted(
  (): {
    config: AutoRechargeConfig | null
    loading: boolean
    saving: boolean
    disabling: boolean
    error: Error | null
    save: ReturnType<typeof vi.fn>
    disable: ReturnType<typeof vi.fn>
    refresh: ReturnType<typeof vi.fn>
  } => ({
    config: null,
    loading: false,
    saving: false,
    disabling: false,
    error: null,
    save: vi.fn(),
    disable: vi.fn(),
    refresh: vi.fn(),
  }),
)

const balanceMocks = vi.hoisted(() => ({
  creditsPerMinorUnit: 100,
  displayExchangeRate: 1,
  displayCurrency: 'USD',
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
    creditsPerMinorUnit: balanceMocks.creditsPerMinorUnit,
    displayExchangeRate: balanceMocks.displayExchangeRate,
    displayCurrency: balanceMocks.displayCurrency,
  }),
}))

const cardSetupMocks = vi.hoisted(() => ({
  createCardSetupGrant: vi.fn(),
  saveCard: vi.fn(),
  capture: vi.fn(),
}))

// `AutoRecharge.CardSetup` reads the card-setup methods off the transport.
vi.mock('../hooks/useTransport', () => ({
  useTransport: () => ({
    createCardSetupGrant: cardSetupMocks.createCardSetupGrant,
    saveCard: cardSetupMocks.saveCard,
  }),
}))

// Stand-in for the vault card fields: renders once a vault is known and,
// on click, registers the capture function and reports the entry complete.
vi.mock('../vault/CardFields', () => ({
  VaultCardFields: (props: {
    vault: { tenantId: string; environment: string } | null
    paymentIntentId: string | null
    onCapture: (capture: unknown) => void
    onComplete: (complete: boolean) => void
  }) =>
    props.vault && props.paymentIntentId ? (
      <button
        type="button"
        data-testid="card-fields"
        data-vault={`${props.vault.tenantId}:${props.vault.environment}`}
        data-session={props.paymentIntentId}
        onClick={() => {
          props.onCapture(cardSetupMocks.capture)
          props.onComplete(true)
        }}
      />
    ) : null,
}))

function returnUrlFor(sessionId: string, base = window.location.href): string {
  const url = new URL(base)
  url.searchParams.set('solvapay_card_setup_session', sessionId)
  return url.toString()
}

function stubAssign(): { assign: ReturnType<typeof vi.fn>; restore: () => void } {
  const original = window.location
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, href: original.href, search: original.search, assign },
  })
  return {
    assign,
    restore: () =>
      Object.defineProperty(window, 'location', { configurable: true, value: original }),
  }
}

function setupGrant(sessionId: string, expiresAt = Date.now() + 60_000) {
  return {
    token: `vgs-token-${sessionId}`,
    tenantId: 'tntr4ol0cbq',
    environment: 'sandbox' as const,
    expiresAt,
    scope: { sessionId },
  }
}

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
    <SolvaPayProvider config={{ initial: makeProviderInitial() }}>
      <AutoRecharge.Root currency="USD" {...props}>
        <AutoRecharge.Card>
          <AutoRecharge.CardSummary />
          <AutoRecharge.StatusMessage />
          <AutoRecharge.Trigger />
        </AutoRecharge.Card>
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
  vi.useRealTimers()
  autoRechargeMocks.config = null
  autoRechargeMocks.loading = false
  autoRechargeMocks.saving = false
  autoRechargeMocks.disabling = false
  autoRechargeMocks.error = null
  autoRechargeMocks.save.mockReset()
  autoRechargeMocks.disable.mockReset()
  autoRechargeMocks.refresh.mockReset().mockResolvedValue(undefined)
  balanceMocks.creditsPerMinorUnit = 100
  balanceMocks.displayExchangeRate = 1
  balanceMocks.displayCurrency = 'USD'
  cardSetupMocks.createCardSetupGrant.mockReset().mockResolvedValue(setupGrant('cs_sess_1'))
  cardSetupMocks.saveCard.mockReset().mockResolvedValue({
    status: 'succeeded',
    paymentMethod: { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 },
  })
  cardSetupMocks.capture.mockReset().mockResolvedValue({
    cardId: 'CRD_setup_1',
    last4: '4242',
    brand: 'VISA',
    expMonth: 12,
    expYear: 2030,
  })
  window.history.replaceState({}, '', '/')
  sessionStorage.clear()
})

describe('AutoRecharge primitive', () => {
  it('renders only the toggle when auto-recharge is off', () => {
    renderAutoRecharge()
    const toggle = screen.getByLabelText('Enable auto-recharge')
    expect(toggle).toBeInTheDocument()
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(/when your balance runs low/i)).toBeInTheDocument()
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
    expect(screen.getByText(/When my balance falls below .* add .*./)).toBeInTheDocument()
  })

  it('shows plus applicable tax disclosure when auto-recharge is enabled', () => {
    renderAutoRecharge({ currency: 'SEK' })
    enableAutoRecharge()
    expect(screen.getByText(enCopy.autoRecharge.taxDisclosure)).toBeInTheDocument()
  })

  it('rejects invalid values inline before save', async () => {
    renderAutoRecharge()
    enableAutoRecharge()
    fireEvent.change(screen.getByLabelText('Fixed top-up amount'), { target: { value: '0.01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(autoRechargeMocks.save).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        interpolate(enCopy.autoRecharge.minTopupAmount, {
          amount: formatPrice(50, 'USD', { free: '' }),
        }),
      )
    })
  })

  it('enforces the per-currency minimum for SEK and blocks save, then saves at the minimum (DEV-582)', async () => {
    autoRechargeMocks.save.mockResolvedValue({ config })
    renderAutoRecharge({ currency: 'SEK' })
    enableAutoRecharge()
    // 1 kr threshold keeps the relationship rule satisfied so we isolate the min check.
    fireEvent.change(screen.getByLabelText('Balance threshold'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Fixed top-up amount'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(autoRechargeMocks.save).not.toHaveBeenCalled()
    // Intl inserts a non-breaking space (e.g. "SEK 3"); toHaveTextContent
    // normalizes DOM whitespace, so normalize the expected string to match.
    const expectedSekMin = interpolate(enCopy.autoRecharge.minTopupAmount, {
      amount: formatPrice(300, 'SEK', { free: '' }),
    }).replace(/\u00a0/g, ' ')
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(expectedSekMin)
    })
    expect(screen.getByRole('alert')).not.toHaveTextContent('$0.50')

    fireEvent.change(screen.getByLabelText('Fixed top-up amount'), { target: { value: '3' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    expect(autoRechargeMocks.save).toHaveBeenCalled()
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
    renderAutoRecharge(
      {},
      <>
        <AutoRecharge.Header />
        <AutoRecharge.Body>
          <AutoRecharge.Actions>
            <AutoRecharge.SaveButton />
            <AutoRecharge.DisableButton />
          </AutoRecharge.Actions>
        </AutoRecharge.Body>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Disable auto-recharge' })).toBeInTheDocument()
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

  it('returns fixed top-up amount to original value after double unit toggle (DEV-591)', () => {
    balanceMocks.displayExchangeRate = 9.46
    balanceMocks.displayCurrency = 'SEK'
    renderAutoRecharge({ currency: 'SEK', defaultTopupAmountMajor: 100 })
    enableAutoRecharge()
    const topupInput = screen.getByLabelText('Fixed top-up amount')
    expect(topupInput).toHaveValue('100')
    fireEvent.click(screen.getByLabelText('Switch fixed top-up amount to credits'))
    expect(topupInput).not.toHaveValue('100')
    fireEvent.click(screen.getByLabelText('Switch fixed top-up amount to currency'))
    expect(topupInput).toHaveValue('100')
  })

  it('shows the vault card setup when save returns requiresPaymentMethod', async () => {
    autoRechargeMocks.save.mockResolvedValue({
      config: { ...config, status: 'pending_setup' },
      requiresPaymentMethod: true,
    })
    renderAutoRecharge()
    enableAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    const fields = await screen.findByTestId('card-fields')
    expect(fields).toHaveAttribute('data-vault', 'tntr4ol0cbq:sandbox')
    expect(fields).toHaveAttribute('data-session', 'cs_sess_1')
    expect(cardSetupMocks.createCardSetupGrant).toHaveBeenCalledTimes(1)
    expect(cardSetupMocks.createCardSetupGrant).toHaveBeenCalledWith()
    expect(screen.getByText(enCopy.autoRecharge.setupRequiredMessage)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enCopy.autoRecharge.setupSubmit })).toBeDisabled()
  })

  it('does not infer the card step from a pending_setup config without requiresPaymentMethod', async () => {
    autoRechargeMocks.save.mockResolvedValue({
      config: { ...config, status: 'pending_setup' },
      requiresPaymentMethod: false,
    })
    renderAutoRecharge()
    enableAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    expect(screen.queryByTestId('card-fields')).not.toBeInTheDocument()
    expect(cardSetupMocks.createCardSetupGrant).not.toHaveBeenCalled()
    expect(screen.getByText('Auto-recharge settings saved.')).toBeInTheDocument()
  })

  it('does not ask for a card when save returns an active config', async () => {
    autoRechargeMocks.save.mockResolvedValue({ config, requiresPaymentMethod: false })
    renderAutoRecharge()
    enableAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    expect(screen.queryByTestId('card-fields')).not.toBeInTheDocument()
    expect(cardSetupMocks.createCardSetupGrant).not.toHaveBeenCalled()
    expect(screen.getByText('Auto-recharge settings saved.')).toBeInTheDocument()
  })

  it('with deferCardSetup, save persists to backend and exposes pending config', async () => {
    const onPendingConfig = vi.fn()
    autoRechargeMocks.save.mockImplementation(async () => {
      autoRechargeMocks.config = config
      // A deferred save ignores the flag: the card is armed on the top-up.
      return { config, requiresPaymentMethod: true }
    })
    renderModalAutoRecharge({ deferCardSetup: true, onPendingConfig })
    openModal()
    enableAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    expect(autoRechargeMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, topupAmountMajor: 10, deferSetupIntent: true }),
    )
    expect(onPendingConfig).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, topupAmountMajor: 10 }),
    )
    expect(screen.queryByTestId('card-fields')).not.toBeInTheDocument()
    expect(cardSetupMocks.createCardSetupGrant).not.toHaveBeenCalled()
    expect(
      screen.queryByText('Auto-recharge settings staged — complete payment to activate.'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Auto-recharge settings saved.')).toBeInTheDocument()
  })

  it('with deferCardSetup, shows saved summary on card after save', async () => {
    autoRechargeMocks.save.mockImplementation(async () => {
      autoRechargeMocks.config = config
      // A deferred save ignores the flag: the card is armed on the top-up.
      return { config, requiresPaymentMethod: true }
    })
    renderModalAutoRecharge({ deferCardSetup: true, onPendingConfig: vi.fn() })
    openModal()
    enableAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByText(/When my balance falls below .* add .*./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Modify' })).toBeInTheDocument()
  })

  it('with deferCardSetup and enabled server config, save updates via API', async () => {
    autoRechargeMocks.config = config
    autoRechargeMocks.save.mockResolvedValue({
      config: {
        ...config,
        trigger: { type: 'balance', thresholdAmountMinor: 400 },
      },
    })
    const onPendingConfig = vi.fn()
    renderModalAutoRecharge({ deferCardSetup: true, onPendingConfig })
    openModal()
    fireEvent.change(screen.getByLabelText('Balance threshold'), { target: { value: '4' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    expect(autoRechargeMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ thresholdAmountMajor: 4 }),
    )
    expect(onPendingConfig).toHaveBeenCalledWith(
      expect.objectContaining({ thresholdAmountMajor: 4 }),
    )
  })

  it('does not show status badge for pending_setup config', () => {
    autoRechargeMocks.config = { ...config, status: 'pending_setup' }
    render(
      <SolvaPayProvider config={{}}>
        <AutoRecharge.Root currency="USD">
          <AutoRecharge.Status />
        </AutoRecharge.Root>
      </SolvaPayProvider>,
    )
    expect(screen.queryByText('Pending card authorization')).not.toBeInTheDocument()
  })

  it('shows max monthly spend field when auto-recharge is enabled', () => {
    renderAutoRecharge()
    enableAutoRecharge()
    expect(screen.getByLabelText('Maximum monthly spend')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('No limit')).toBeInTheDocument()
    expect(
      screen.getByText('Leave blank to allow unlimited auto-reloaded credits per month.'),
    ).toBeInTheDocument()
  })

  it('saves maxMonthlySpendMajor when the cap is set', async () => {
    autoRechargeMocks.save.mockResolvedValue({ config })
    renderAutoRecharge()
    enableAutoRecharge()
    fireEvent.change(screen.getByLabelText('Maximum monthly spend'), {
      target: { value: '100' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    expect(autoRechargeMocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ maxMonthlySpendMajor: 100 }),
    )
  })

  it('shows monthly spend limit reached status when cap would be exceeded', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
      autoRechargeMocks.config = {
        ...config,
        maxMonthlySpendMinor: 10_000,
        monthlySpendMinor: 9500,
        monthlySpendPeriod: '2026-07',
      }
      render(
        <SolvaPayProvider config={{}}>
          <AutoRecharge.Root currency="USD">
            <AutoRecharge.Status />
          </AutoRecharge.Root>
        </SolvaPayProvider>,
      )
      expect(screen.getByText('Monthly spend limit reached')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows monthly spend line when config has a cap', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
      autoRechargeMocks.config = {
        ...config,
        maxMonthlySpendMinor: 10_000,
        monthlySpendMinor: 4500,
        monthlySpendPeriod: '2026-07',
      }
      render(
        <SolvaPayProvider config={{}}>
          <AutoRecharge.Root currency="USD">
            <AutoRecharge.MonthlySpend />
          </AutoRecharge.Root>
        </SolvaPayProvider>,
      )
      expect(screen.getByText('$45 / $100 this month')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('AutoRecharge modal flow', () => {
  it('opens dialog from trigger and shows settings title', () => {
    renderModalAutoRecharge()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    openModal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Auto-recharge settings')).toBeInTheDocument()
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

describe('AutoRecharge card setup confirmation (DEV-581)', () => {
  const pendingConfig: AutoRechargeConfig = { ...config, status: 'pending_setup' }

  function saveReturnsPendingSetup(): void {
    autoRechargeMocks.config = { ...pendingConfig }
    autoRechargeMocks.save.mockResolvedValue({
      config: { ...pendingConfig },
      requiresPaymentMethod: true,
    })
  }

  async function openCardSetup(): Promise<void> {
    // pendingConfig is already enabled, so the form renders without toggling.
    renderAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    const fields = await screen.findByTestId('card-fields')
    await act(async () => {
      fireEvent.click(fields)
    })
  }

  async function submitCardSetup(): Promise<void> {
    await openCardSetup()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: enCopy.autoRecharge.setupSubmit }))
    })
  }

  it('marks saved once the server confirms activation', async () => {
    saveReturnsPendingSetup()
    autoRechargeMocks.refresh.mockImplementation(async () => {
      if (autoRechargeMocks.config) autoRechargeMocks.config.status = 'active'
    })

    await submitCardSetup()

    await waitFor(() => {
      expect(screen.getByText(enCopy.autoRecharge.savedMessage)).toBeInTheDocument()
    })
    expect(cardSetupMocks.capture).toHaveBeenCalledTimes(1)
    expect(cardSetupMocks.capture).toHaveBeenCalledWith(
      setupGrant('cs_sess_1', expect.any(Number) as never),
    )
    expect(cardSetupMocks.saveCard).toHaveBeenCalledTimes(1)
    expect(cardSetupMocks.saveCard).toHaveBeenCalledWith({
      sessionId: 'cs_sess_1',
      cardId: 'CRD_setup_1',
      returnUrl: returnUrlFor('cs_sess_1'),
    })
    expect(cardSetupMocks.capture.mock.invocationCallOrder[0]).toBeLessThan(
      cardSetupMocks.saveCard.mock.invocationCallOrder[0],
    )
    expect(autoRechargeMocks.refresh).toHaveBeenCalledWith(true)
  })

  it('shows awaiting confirmation (not saved) when the server never activates', async () => {
    saveReturnsPendingSetup()
    // Server stays pending_setup across every poll (webhook never lands in time).
    autoRechargeMocks.refresh.mockResolvedValue(undefined)

    await openCardSetup()
    // Do not await the full poll inside act — let waitFor observe the outcome.
    fireEvent.click(screen.getByRole('button', { name: enCopy.autoRecharge.setupSubmit }))

    await waitFor(
      () => {
        expect(screen.getByText(enCopy.autoRecharge.setupAwaitingConfirmation)).toBeInTheDocument()
      },
      { timeout: 8000 },
    )
    expect(screen.queryByText(enCopy.autoRecharge.savedMessage)).not.toBeInTheDocument()
  }, 12000)

  it('refreshes an expired grant at submit and saves the card on the new session', async () => {
    saveReturnsPendingSetup()
    cardSetupMocks.createCardSetupGrant
      .mockReset()
      .mockResolvedValueOnce(setupGrant('cs_sess_old', Date.now() - 1_000))
      .mockResolvedValueOnce(setupGrant('cs_sess_new'))
    autoRechargeMocks.refresh.mockImplementation(async () => {
      if (autoRechargeMocks.config) autoRechargeMocks.config.status = 'active'
    })

    await submitCardSetup()

    await waitFor(() => {
      expect(screen.getByText(enCopy.autoRecharge.savedMessage)).toBeInTheDocument()
    })
    expect(cardSetupMocks.createCardSetupGrant).toHaveBeenCalledTimes(2)
    expect(cardSetupMocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'vgs-token-cs_sess_new',
        scope: { sessionId: 'cs_sess_new' },
      }),
    )
    expect(cardSetupMocks.saveCard).toHaveBeenCalledWith({
      sessionId: 'cs_sess_new',
      cardId: 'CRD_setup_1',
      returnUrl: returnUrlFor('cs_sess_new'),
    })
  })

  it('refuses a grant scoped to a payment: no card fields, the auth error shown', async () => {
    saveReturnsPendingSetup()
    cardSetupMocks.createCardSetupGrant.mockReset().mockResolvedValue({
      ...setupGrant('cs_sess_1'),
      scope: { paymentIntentId: 'pi_1' },
    })

    renderAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    await waitFor(() => {
      expect(screen.getByText(enCopy.autoRecharge.setupAuthFailed)).toBeInTheDocument()
    })
    expect(cardSetupMocks.createCardSetupGrant).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('card-fields')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: enCopy.autoRecharge.setupSubmit })).toBeDisabled()
    expect(cardSetupMocks.capture).not.toHaveBeenCalled()
    expect(cardSetupMocks.saveCard).not.toHaveBeenCalled()
  })

  it('shows the card-capture copy and does not save when the vault rejects the card', async () => {
    const { CardCaptureError } = await import('../vault/collect')
    saveReturnsPendingSetup()
    cardSetupMocks.capture.mockRejectedValue(new CardCaptureError('invalid card'))

    await submitCardSetup()

    await waitFor(() => {
      expect(screen.getByText(enCopy.errors.cardCaptureFailed)).toBeInTheDocument()
    })
    expect(cardSetupMocks.saveCard).not.toHaveBeenCalled()
    expect(autoRechargeMocks.refresh).not.toHaveBeenCalled()
  })

  it('surfaces a save failure verbatim and leaves the setup open', async () => {
    saveReturnsPendingSetup()
    cardSetupMocks.saveCard.mockRejectedValue(new Error('Failed to save card: Bad Gateway'))

    await submitCardSetup()

    await waitFor(() => {
      expect(screen.getByText('Failed to save card: Bad Gateway')).toBeInTheDocument()
    })
    expect(screen.getByTestId('card-fields')).toBeInTheDocument()
    expect(autoRechargeMocks.refresh).not.toHaveBeenCalled()
  })

  it('shows the grant error and no card fields when card setup cannot start', async () => {
    saveReturnsPendingSetup()
    cardSetupMocks.createCardSetupGrant
      .mockReset()
      .mockRejectedValue(new Error('Failed to start card setup: Unauthorized'))

    renderAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })

    await waitFor(() => {
      expect(screen.getByText('Failed to start card setup: Unauthorized')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('card-fields')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: enCopy.autoRecharge.setupSubmit })).toBeDisabled()
  })
})

describe('AutoRecharge card setup outcomes', () => {
  const pendingConfig: AutoRechargeConfig = { ...config, status: 'pending_setup' }

  async function submitPendingSetup(): Promise<void> {
    autoRechargeMocks.config = { ...pendingConfig }
    autoRechargeMocks.save.mockResolvedValue({
      config: { ...pendingConfig },
      requiresPaymentMethod: true,
    })
    renderAutoRecharge()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    })
    const fields = await screen.findByTestId('card-fields')
    await act(async () => {
      fireEvent.click(fields)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: enCopy.autoRecharge.setupSubmit }))
    })
  }

  it('sends the payer to the 3DS redirect on requires_action and keeps the button busy', async () => {
    const { assign, restore } = stubAssign()
    try {
      cardSetupMocks.saveCard.mockResolvedValue({
        status: 'requires_action',
        redirectUrl: 'https://acs.bank.test/3ds/setup',
      })

      await submitPendingSetup()

      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
      expect(assign).toHaveBeenCalledWith('https://acs.bank.test/3ds/setup')
      expect(autoRechargeMocks.refresh).not.toHaveBeenCalled()
      expect(
        screen.getByRole('button', { name: enCopy.autoRecharge.setupProcessing }),
      ).toBeDisabled()
    } finally {
      restore()
    }
  })

  it('shows the pending copy and re-reads the config on processing', async () => {
    cardSetupMocks.saveCard.mockResolvedValue({ status: 'processing' })

    await submitPendingSetup()

    await waitFor(() => expect(autoRechargeMocks.refresh).toHaveBeenCalledWith(true))
    expect(autoRechargeMocks.refresh).toHaveBeenCalledTimes(1)
    const pendingNotes = screen.getAllByText(enCopy.autoRecharge.setupAwaitingConfirmation)
    expect(pendingNotes.map(node => node.tagName)).toEqual(['P', 'P'])
    expect(document.querySelector('[data-solvapay-auto-recharge-setup-pending]')?.textContent).toBe(
      enCopy.autoRecharge.setupAwaitingConfirmation,
    )
    expect(screen.queryByText(enCopy.autoRecharge.savedMessage)).not.toBeInTheDocument()
  })

  it('shows the error copy and re-enables the button on any other status', async () => {
    cardSetupMocks.saveCard.mockResolvedValue({ status: 'failed' })

    await submitPendingSetup()

    await waitFor(() => {
      expect(screen.getByText(enCopy.autoRecharge.setupAuthFailed)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: enCopy.autoRecharge.setupSubmit })).not.toBeDisabled()
    expect(autoRechargeMocks.refresh).not.toHaveBeenCalled()
  })

  it('treats requires_action without a redirect url as a failure', async () => {
    cardSetupMocks.saveCard.mockResolvedValue({ status: 'requires_action' })

    await submitPendingSetup()

    await waitFor(() => {
      expect(screen.getByText(enCopy.autoRecharge.setupAuthFailed)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: enCopy.autoRecharge.setupSubmit })).not.toBeDisabled()
  })
})

describe('AutoRecharge card setup 3DS return', () => {
  const pendingConfig: AutoRechargeConfig = { ...config, status: 'pending_setup' }

  function arriveBack(extra = ''): void {
    window.history.replaceState(
      {},
      '',
      `/billing?tab=credits&solvapay_card_setup_session=cs_sess_1${extra}`,
    )
  }

  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })

  it('completes the pending setup on the session, strips the params, and reports saved', async () => {
    arriveBack('&redirect_status=succeeded&setup_intent=seti_1&setup_intent_client_secret=secret')
    autoRechargeMocks.config = { ...pendingConfig }
    autoRechargeMocks.refresh.mockImplementation(async () => {
      if (autoRechargeMocks.config) autoRechargeMocks.config.status = 'active'
    })

    renderAutoRecharge()

    await waitFor(() => {
      expect(screen.getByText(enCopy.autoRecharge.savedMessage)).toBeInTheDocument()
    })
    expect(cardSetupMocks.saveCard).toHaveBeenCalledTimes(1)
    expect(cardSetupMocks.saveCard).toHaveBeenCalledWith({
      sessionId: 'cs_sess_1',
      completePendingSetup: true,
    })
    expect(window.location.search).toBe('?tab=credits')
    expect(autoRechargeMocks.refresh).toHaveBeenCalledWith(true)
    expect(cardSetupMocks.createCardSetupGrant).not.toHaveBeenCalled()
  })

  it('shows the pending copy and re-reads the config when the finish is processing', async () => {
    arriveBack()
    autoRechargeMocks.config = { ...pendingConfig }
    cardSetupMocks.saveCard.mockResolvedValue({ status: 'processing' })

    renderAutoRecharge()

    await waitFor(() => {
      expect(screen.getByText(enCopy.autoRecharge.setupAwaitingConfirmation)).toBeInTheDocument()
    })
    expect(autoRechargeMocks.refresh).toHaveBeenCalledWith(true)
    expect(autoRechargeMocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('shows the error copy when the finish fails', async () => {
    arriveBack()
    autoRechargeMocks.config = { ...pendingConfig }
    cardSetupMocks.saveCard.mockRejectedValue(new Error('Failed to save card: Bad Gateway'))

    renderAutoRecharge()

    await waitFor(() => {
      expect(screen.getByText(enCopy.autoRecharge.setupAuthFailed)).toBeInTheDocument()
    })
    expect(autoRechargeMocks.refresh).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?tab=credits')
  })

  it('does nothing without the return params', async () => {
    autoRechargeMocks.config = { ...pendingConfig }
    renderAutoRecharge()
    await act(async () => {
      await Promise.resolve()
    })
    expect(cardSetupMocks.saveCard).not.toHaveBeenCalled()
  })
})
