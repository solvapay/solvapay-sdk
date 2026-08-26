import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { resetNativeCoreApiForTests } from '@solvapay/core'
import { McpApp, type McpAppFull } from './index'
import { merchantCache } from '../hooks/useMerchant'

type ToolResultHandler = (params: {
  structuredContent?: unknown
  isError?: boolean
  content?: Array<{ type: string; text?: string }>
}) => void

function makeApp(structuredContent: unknown): McpAppFull {
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
      return { toolInfo: { tool: { name: 'manage_account' } } }
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

beforeEach(() => {
  // mcp-core's barrel evaluates `@solvapay/server`, which installs napi.
  // The widget tree-shakes that away; reset so this file sees `installed === null`.
  resetNativeCoreApiForTests()
})

afterEach(() => {
  cleanup()
  merchantCache.clear()
})

describe('<McpApp> with no native core binding', () => {
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
      },
      product: { reference: 'prd_1', name: 'Acme Knowledge Base' },
      plans: [],
      customer: {
        ref: 'cus_1',
        email: 'demo@acme.test',
        name: 'Demo',
        purchase: null,
        paymentMethod: null,
        balance: { credits: 1500, displayCurrency: 'USD', creditsPerMinorUnit: 100 },
        usage: null,
      },
    })

    render(<McpApp app={app} />)

    expect(await screen.findByText('Verified seller')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Seller' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Your account' })).toBeTruthy()
    expect(screen.getByText('Acme Inc.')).toBeTruthy()
    expect(screen.getByText('cus_1')).toBeTruthy()
  })
})
