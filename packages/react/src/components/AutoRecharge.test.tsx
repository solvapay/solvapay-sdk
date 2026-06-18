/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { AutoRecharge } from './AutoRecharge'
import { SolvaPayProvider } from '../SolvaPayProvider'

vi.mock('../hooks/useAutoRecharge', () => ({
  useAutoRecharge: () => ({
    config: null,
    loading: false,
    saving: false,
    disabling: false,
    error: null,
    refresh: vi.fn(),
    save: vi.fn(),
    disable: vi.fn(),
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
  Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useStripe: () => null,
  useElements: () => null,
  PaymentElement: () => null,
}))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}))

function renderShim(props: Partial<React.ComponentProps<typeof AutoRecharge>> = {}) {
  return render(
    <SolvaPayProvider config={{}}>
      <AutoRecharge currency="USD" {...props} />
    </SolvaPayProvider>,
  )
}

function openModal(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Set up auto-recharge' }))
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
})

describe('AutoRecharge (default-tree shim)', () => {
  it('renders summary card with solvapay class hooks', () => {
    renderShim()
    expect(document.querySelector('.solvapay-auto-recharge')).toBeInTheDocument()
    expect(document.querySelector('.solvapay-auto-recharge-card')).toBeInTheDocument()
    expect(screen.getByText('Auto recharge')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set up auto-recharge' })).toBeInTheDocument()
  })

  it('shows form fields in dialog when enabled', () => {
    renderShim()
    openModal()
    fireEvent.click(screen.getByLabelText('Enable auto-recharge'))
    expect(screen.getByText('When balance falls below')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('accepts className on root', () => {
    renderShim({ className: 'custom-auto-recharge' })
    expect(document.querySelector('.solvapay-auto-recharge.custom-auto-recharge')).toBeTruthy()
  })
})
