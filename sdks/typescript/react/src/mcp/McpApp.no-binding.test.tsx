import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { minorUnitsPerMajor } from '@solvapay/core'
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

describe('<McpApp> with no native core binding', () => {
  it('should throw from dispatchSync when no binding is installed', () => {
    expect(() => minorUnitsPerMajor('USD')).toThrow(/core sync API not installed \(minorUnitsPerMajor\)/)
  })

  it('should render seller and customer cards when no binding is installed', async () => {
    const app = makeApp({
      view: 'account',
      productRef: 'prd_1',
      returnUrl: 'https://example.test/r',
      merchant: {
        displayName: 'Acme',
        legalName: 'Acme Inc.',
        country: 'DE',
        vatNumber: 'DE123456789',
        identityDisplay: {
          taxIdentifier: { label: 'VAT number', value: 'DE123456789' },
          companyNumber: null,
        },
      },
      product: { reference: 'prd_1', name: 'Acme Knowledge Base' },
      plans: [],
      taxIdFields: {
        DE: { label: 'VAT ID', example: 'DE123456789', helperText: 'Enter your full VAT ID including the country code, e.g. DE123456789' },
        GB: { label: 'VAT Number', example: 'GB123456789', helperText: 'Enter your full VAT number including the country code, e.g. GB123456789' },
      },
      customer: {
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
      },
    })

    render(<McpApp app={app} />)

    expect(await screen.findByText('Verified seller')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Seller' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeTruthy()
    expect(screen.getByText('Acme Inc.')).toBeTruthy()
    expect(screen.getByText('cus_1')).toBeTruthy()
    expect(screen.getByText('VAT number')).toBeTruthy()
    expect(screen.getByText('DE123456789')).toBeTruthy()
  })

  it('should render the checkout plan step when no binding is installed', async () => {
    const app = makeApp(
      {
        view: 'checkout',
        productRef: 'prd_1',
        returnUrl: 'https://example.test/r',
        stripePublishableKey: null,
        merchant: {
          displayName: 'Acme',
          legalName: 'Acme Inc.',
          country: 'DE',
          vatNumber: 'DE123456789',
          identityDisplay: {
            taxIdentifier: { label: 'VAT number', value: 'DE123456789' },
            companyNumber: null,
          },
        },
        product: { reference: 'prd_1', name: 'Acme Knowledge Base' },
        plans: [
          {
            reference: 'pln_pro',
            name: 'Pro',
            price: 1800,
            currency: 'USD',
            requiresPayment: true,
            type: 'recurring',
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
          },
        ],
        customer: {
          ref: 'cus_1',
          email: 'demo@acme.test',
          name: 'Demo',
          purchase: null,
          paymentMethod: null,
          balance: null,
          usage: null,
        },
      },
      'upgrade',
    )

    render(<McpApp app={app} />)

    expect(await screen.findByText('Choose a plan')).toBeTruthy()
    expect(screen.getByText('Pro')).toBeTruthy()
    expect(screen.getByText('$18')).toBeTruthy()
  })

  it('should render a diagnostic when a child throws', async () => {
    function Boom(): React.ReactElement {
      throw new Error('core sync API not installed (headlineCharges)')
    }
    const log = vi.fn()
    const app = makeApp({
      view: 'account',
      productRef: 'prd_1',
      returnUrl: 'https://example.test/r',
      merchant: {
        displayName: 'Acme',
        legalName: 'Acme Inc.',
        country: 'DE',
        vatNumber: 'DE123456789',
        identityDisplay: {
          name: 'Acme Inc.',
          country: 'DE',
          vatLabel: 'VAT ID',
          vatNumber: 'DE123456789',
        },
      },
      product: { name: 'Demo', description: null },
      plans: [],
      customer: {
        ref: 'cus_1',
        email: 'demo@acme.test',
        name: 'Demo',
        purchase: null,
        paymentMethod: null,
        balance: null,
        usage: null,
      },
    })
    app.log = log

    render(<McpApp app={app} views={{ account: Boom }} />)

    expect(await screen.findByText('Unable to load SolvaPay')).toBeTruthy()
    expect(screen.getByText(/core sync API not installed \(headlineCharges\)/)).toBeTruthy()
    expect(log).toHaveBeenCalledWith('core sync API not installed (headlineCharges)')
  })
})
