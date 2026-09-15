import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { SolvaPayContext } from '../../../SolvaPayProvider'
import type { SolvaPayContextValue } from '../../../types'
import { mockBalanceStatus } from '../../../test-helpers/mockBalanceStatus'
import { McpDisplayModeProvider } from '../../hooks/useDisplayMode'
import { McpPayingAs } from '../McpPayingAs'

function stubContext(email: string | undefined): SolvaPayContextValue {
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
      email,
      name: 'Ada',
    },
    refetchPurchase: async () => undefined,
    upsertPurchase: () => undefined,
    createPayment: async () => {
      throw new Error('unused')
    },
    createTopupPayment: async () => {
      throw new Error('unused')
    },
    cancelRenewal: async () => {
      throw new Error('unused')
    },
    reactivateRenewal: async () => {
      throw new Error('unused')
    },
    activatePlan: async () => {
      throw new Error('unused')
    },
    balance: mockBalanceStatus({ displayCurrency: 'USD' }),
    _config: {},
  }
}

function renderPayingAs(
  props: React.ComponentProps<typeof McpPayingAs> = {},
  options: { email?: string | undefined; displayMode?: 'inline' | 'fullscreen' } = {},
) {
  const displayMode = options.displayMode ?? 'inline'
  return render(
    <SolvaPayContext.Provider value={stubContext(options.email)}>
      <McpDisplayModeProvider
        value={{
          displayMode,
          availableDisplayModes: ['inline', 'fullscreen'],
          hostedRail: 'inline',
        }}
      >
        <McpPayingAs {...props} />
      </McpDisplayModeProvider>
    </SolvaPayContext.Provider>,
  )
}

describe('<McpPayingAs>', () => {
  it('renders nothing when there is no email', () => {
    const { container } = renderPayingAs({}, { email: undefined })
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the email prop is blank', () => {
    const { container } = renderPayingAs({ email: '  ' }, { email: 'ada@acme.test' })
    expect(container.firstChild).toBeNull()
  })

  it('renders a single inline span from the customer email', () => {
    renderPayingAs({}, { email: 'ada@acme.test' })
    const node = screen.getByText('Paying as ada@acme.test')
    expect(node.tagName).toBe('SPAN')
    expect(node).toHaveAttribute('data-variant', 'inline')
    expect(node).toHaveClass('solvapay-mcp-paying-as')
  })

  it('prefers the email prop over the customer email', () => {
    renderPayingAs({ email: 'override@acme.test' }, { email: 'ada@acme.test' })
    expect(screen.getByText('Paying as override@acme.test')).toBeTruthy()
    expect(screen.queryByText('Paying as ada@acme.test')).toBeNull()
  })

  it('stacks the label over the email in fullscreen', () => {
    const { container } = renderPayingAs({}, { email: 'ada@acme.test', displayMode: 'fullscreen' })
    const root = container.querySelector('.solvapay-mcp-paying-as')
    expect(root).toHaveAttribute('data-variant', 'stacked')
    expect(root?.querySelector('.solvapay-mcp-paying-as-label')?.textContent).toBe('Paying as')
    expect(root?.querySelector('.solvapay-mcp-paying-as-email')?.textContent).toBe('ada@acme.test')
    expect(screen.queryByText('Paying as ada@acme.test')).toBeNull()
  })
})
