import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { McpApp, type McpAppFull } from './McpApp'
import { merchantCache } from '../hooks/useMerchant'
import { seedTaxIdFields } from '../utils/tax-id-fields'

vi.mock('./useStripeProbe', () => ({
  useStripeProbe: () => 'ready',
}))

type ToolResultHandler = (params: {
  structuredContent?: unknown
  isError?: boolean
  content?: Array<{ type: string; text?: string }>
}) => void

const merchant = {
  displayName: 'Acme',
  legalName: 'Acme Inc.',
  country: 'DE',
  vatNumber: 'DE123456789',
  identityDisplay: {
    taxIdentifier: { label: 'VAT number', value: 'DE123456789' },
    companyNumber: null,
  },
}

const product = { reference: 'prd_1', name: 'Acme Knowledge Base' }

const customer = {
  ref: 'cus_1',
  email: 'demo@acme.test',
  name: 'Demo',
  purchase: null,
  paymentMethod: null,
  balance: {
    credits: 1500,
    displayCurrency: 'USD',
    creditsPerMinorUnit: 100,
    displayMinorUnits: 15,
    minorUnitsPerMajor: 100,
  },
  usage: null,
}

const plan = {
  reference: 'pln_pro',
  name: 'Pro',
  price: 1800,
  currency: 'USD',
  requiresPayment: true,
  type: 'recurring',
  planType: 'usage-based',
  pricingOptions: [{ currency: 'USD', price: 1800, default: true }],
  display: {
    billingCycle: { interval: 'month' },
    countsUsage: false,
    includedUnits: null,
    meterName: null,
    perUnitCharge: null,
    creditsPerUnit: null,
    trialDays: null,
  },
  options: [
    { kind: 'billingCycle', interval: 'month' },
    { kind: 'charge', per: 'flat', amountMinor: 1800, currency: 'USD' },
  ],
}

function makeApp(structuredContent: unknown, toolName = 'manage_account'): McpAppFull {
  const listeners: Record<string, ToolResultHandler[]> = {}
  let connected = false

  const fireToolResult: ToolResultHandler = params => {
    for (const handler of listeners['toolresult'] ?? []) handler(params)
    app.ontoolresult?.(params)
  }

  const app: McpAppFull = {
    callServerTool: vi.fn().mockResolvedValue({ structuredContent }),
    readServerResource: vi.fn().mockImplementation(async () => ({
      contents: [{ text: JSON.stringify(structuredContent) }],
    })),
    getHostContext: () => {
      if (!connected) return undefined
      return { toolInfo: { tool: { name: toolName } } }
    },
    connect: vi.fn().mockImplementation(async () => {
      connected = true
      await Promise.resolve()
      fireToolResult({ structuredContent })
    }),
    addEventListener: vi.fn((evt: string, handler: ToolResultHandler) => {
      ;(listeners[evt] ??= []).push(handler)
    }),
    removeEventListener: vi.fn((evt: string, handler: ToolResultHandler) => {
      const bucket = listeners[evt] ?? []
      const idx = bucket.indexOf(handler)
      if (idx >= 0) bucket.splice(idx, 1)
    }),
    onhostcontextchanged: undefined,
    onteardown: undefined,
    requestTeardown: vi.fn().mockResolvedValue(undefined),
    ontoolresult: undefined,
  }

  return app
}

afterEach(() => {
  cleanup()
  merchantCache.clear()
  seedTaxIdFields(null)
})

async function expectNoCoreBindingError(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText(/core sync API not installed/)).toBeNull()
    expect(screen.queryByText(/missing sync method/)).toBeNull()
    expect(screen.queryByText('Unable to load SolvaPay')).toBeNull()
  })
}

describe('<McpApp> against the installed native core', () => {
  it('renders the account view without a missing sync method', async () => {
    render(
      <McpApp
        app={makeApp({
          view: 'account',
          productRef: 'prd_1',
          returnUrl: 'https://example.test/r',
          merchant,
          product,
          plans: [plan],
          customer,
        })}
      />,
    )
    await expectNoCoreBindingError()
  })

  it('renders the checkout view without a missing sync method', async () => {
    render(
      <McpApp
        app={makeApp(
          {
            view: 'checkout',
            productRef: 'prd_1',
            returnUrl: 'https://example.test/r',
            stripePublishableKey: null,
            merchant,
            product,
            plans: [plan],
            customer,
          },
          'upgrade',
        )}
      />,
    )
    await expectNoCoreBindingError()
  })

  it('renders the topup view without a missing sync method', async () => {
    render(
      <McpApp
        app={makeApp({
          view: 'topup',
          productRef: 'prd_1',
          returnUrl: 'https://example.test/r',
          merchant,
          product,
          plans: [plan],
          customer,
        })}
      />,
    )
    await expectNoCoreBindingError()
  })

  it('renders the auto-recharge view without a missing sync method', async () => {
    render(
      <McpApp
        app={makeApp({
          view: 'auto-recharge',
          productRef: 'prd_1',
          returnUrl: 'https://example.test/r',
          merchant,
          product,
          plans: [plan],
          customer,
        })}
      />,
    )
    await expectNoCoreBindingError()
  })
})
