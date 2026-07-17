/**
 * Snapshot-style shape test for `buildSolvaPayDescriptors`. Guards the
 * tool list, names, descriptions, and meta envelope so the contract
 * doesn't silently drift between framework adapters.
 */

import { describe, expect, it, vi } from 'vitest'
import { createSolvaPay, type SolvaPayClient } from '@solvapay/server'
import {
  buildSolvaPayDescriptors,
  buildSolvaPayPrompts,
  deriveIcons,
  MCP_TOOL_NAMES,
  OPEN_TOOL_FOR_VIEW,
  TOOL_FOR_VIEW,
  VIEW_FOR_OPEN_TOOL,
  VIEW_FOR_TOOL,
} from '../src'

interface MakeSolvaPayOverrides {
  customer?: {
    customerRef: string
    externalRef?: string
    email?: string
    name?: string
    purchases?: Array<Record<string, unknown>>
  }
  merchant?: Record<string, unknown>
  product?: Record<string, unknown>
  plans?: Array<Record<string, unknown>>
  balance?: {
    customerRef: string
    credits: number
    displayCurrency: string
    creditsPerMinorUnit: number
    displayExchangeRate: number
  }
  paymentMethod?: Record<string, unknown>
}

function makeSolvaPay(overrides: MakeSolvaPayOverrides = {}) {
  const customer = overrides.customer ?? {
    customerRef: 'cus_existing',
    externalRef: 'cus_existing',
    purchases: [],
  }
  const client = {
    checkLimits: vi.fn().mockResolvedValue({ withinLimits: true, remaining: 1, plan: 'free' }),
    trackUsage: vi.fn().mockResolvedValue(undefined),
    createCustomer: vi.fn().mockResolvedValue({ customerRef: customer.customerRef }),
    getCustomer: vi.fn().mockResolvedValue(customer),
    getPlatformConfig: vi.fn().mockResolvedValue({ stripePublishableKey: 'pk_test_123' }),
    getMerchant: vi
      .fn()
      .mockResolvedValue(overrides.merchant ?? { displayName: 'Acme', legalName: 'Acme Inc' }),
    getProduct: vi
      .fn()
      .mockResolvedValue(overrides.product ?? { reference: 'prd_test', name: 'Test product' }),
    listPlans: vi
      .fn()
      .mockResolvedValue(overrides.plans ?? [{ reference: 'pln_basic', name: 'Basic' }]),
    getCustomerBalance: vi.fn().mockResolvedValue(
      overrides.balance ?? {
        customerRef: customer.customerRef,
        credits: 0,
        displayCurrency: 'USD',
        creditsPerMinorUnit: 1,
        displayExchangeRate: 1,
      },
    ),
    getPaymentMethod: vi.fn().mockResolvedValue(overrides.paymentMethod ?? { kind: 'none' }),
  } as unknown as SolvaPayClient
  return createSolvaPay({ apiClient: client })
}

describe('buildSolvaPayDescriptors', () => {
  it('returns the canonical tool list in a stable shape', () => {
    const { tools, resource } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })

    const names = tools.map(t => t.name).sort()
    expect(names).toEqual(
      [
        MCP_TOOL_NAMES.activatePlan,
        MCP_TOOL_NAMES.attachBusinessDetails,
        MCP_TOOL_NAMES.cancelRenewal,
        MCP_TOOL_NAMES.createCheckoutSession,
        MCP_TOOL_NAMES.createCustomerSession,
        MCP_TOOL_NAMES.createPayment,
        MCP_TOOL_NAMES.createTopupPayment,
        MCP_TOOL_NAMES.manageAccount,
        MCP_TOOL_NAMES.processPayment,
        MCP_TOOL_NAMES.reactivateRenewal,
        MCP_TOOL_NAMES.topup,
        MCP_TOOL_NAMES.upgrade,
      ].sort(),
    )

    for (const tool of tools) {
      expect(tool.description).toBeTypeOf('string')
      expect(tool.description.length).toBeGreaterThan(10)
      expect(tool.handler).toBeTypeOf('function')
      expect(tool.meta).toMatchObject({ ui: { resourceUri: 'ui://test/view.html' } })
    }

    // Intent tools (LLM-callable, dual-audience) carry the plain
    // `{ ui: { resourceUri } }` meta with no audience tag.
    const intentTools = [
      MCP_TOOL_NAMES.upgrade,
      MCP_TOOL_NAMES.manageAccount,
      MCP_TOOL_NAMES.topup,
      MCP_TOOL_NAMES.activatePlan,
    ]
    for (const name of intentTools) {
      const tool = tools.find(t => t.name === name)
      expect(tool).toBeTruthy()
      expect((tool!.meta as Record<string, unknown>).audience).toBeUndefined()
      const visibility = (tool!.meta as { ui?: { visibility?: readonly string[] } }).ui
        ?.visibility
      expect(visibility).not.toEqual(['app'])
    }

    // UI-transport tools (state-change, no LLM use) all tag themselves.
    const uiOnlyTools = [
      MCP_TOOL_NAMES.attachBusinessDetails,
      MCP_TOOL_NAMES.createPayment,
      MCP_TOOL_NAMES.processPayment,
      MCP_TOOL_NAMES.createTopupPayment,
      MCP_TOOL_NAMES.cancelRenewal,
      MCP_TOOL_NAMES.reactivateRenewal,
      MCP_TOOL_NAMES.createCheckoutSession,
      MCP_TOOL_NAMES.createCustomerSession,
    ]
    for (const name of uiOnlyTools) {
      const tool = tools.find(t => t.name === name)
      expect(tool).toBeTruthy()
      expect((tool!.meta as Record<string, unknown>).audience).toBe('ui')
      expect((tool!.meta as { ui?: { visibility?: readonly string[] } }).ui?.visibility).toEqual([
        'app',
      ])
      expect((tool!.meta as Record<string, unknown>)['openai/widgetAccessible']).toBe(true)
      expect(tool!.description).toMatch(/UI-only/i)
    }

    expect(resource.uri).toBe('ui://test/view.html')
    expect(resource.mimeType).toBe('text/html;profile=mcp-app')
    expect(resource.readHtml).toBeTypeOf('function')
    expect(resource.csp.resourceDomains).toContain('https://js.stripe.com')
  })

  it('marks all intent tools as read-only view openers', () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })

    for (const name of [MCP_TOOL_NAMES.upgrade, MCP_TOOL_NAMES.topup, MCP_TOOL_NAMES.manageAccount]) {
      const tool = tools.find(t => t.name === name)!
      expect(tool.annotations).toMatchObject({
        openWorldHint: true,
        readOnlyHint: true,
        idempotentHint: true,
      })
      expect(tool.annotations?.destructiveHint).toBeUndefined()
    }
  })

  it('does not register tools removed/renamed in the Phase 2 trim', () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })
    const names = tools.map(t => t.name)
    for (const removed of [
      // Phase 1 + 2c — dropped read tools
      'sync_customer',
      'check_purchase',
      'get_merchant',
      'get_product',
      'get_payment_method',
      'get_customer_balance',
      'get_usage',
      'list_plans',
      // Phase 2d — paywall now rides on the gate response
      'open_paywall',
      // Phase 2e — renamed to intent verbs
      'open_checkout',
      'open_account',
      'open_topup',
      'open_usage',
      'open_plan_activation',
      // SDK refactor — tabbed shell deleted; usage folds into account,
      // about is served by tool descriptions + docs resources.
      'check_usage',
      'open_about',
    ]) {
      expect(names).not.toContain(removed)
    }
  })

  it('filters intent tools by views option', () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
      views: ['checkout'],
    })
    const names = tools.map(t => t.name)
    expect(names).toContain(MCP_TOOL_NAMES.upgrade)
    expect(names).not.toContain(MCP_TOOL_NAMES.manageAccount)
    expect(names).not.toContain(MCP_TOOL_NAMES.topup)
  })

  it('rejects non-http publicBaseUrl with the frozen message', () => {
    expect(() =>
      buildSolvaPayDescriptors({
        solvaPay: makeSolvaPay(),
        productRef: 'prd_test',
        resourceUri: 'ui://test/view.html',
        readHtml: async () => '<html></html>',
        publicBaseUrl: 'ui://nope',
      }),
    ).toThrow(
      'buildSolvaPayDescriptors: publicBaseUrl must be an http(s) URL (Stripe confirmPayment rejects `ui://`).',
    )
  })

  it('keeps transport tools + activate_plan when views is empty', () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
      views: [],
    })
    const names = tools.map(t => t.name)
    expect(names).not.toContain(MCP_TOOL_NAMES.upgrade)
    expect(names).not.toContain(MCP_TOOL_NAMES.manageAccount)
    expect(names).not.toContain(MCP_TOOL_NAMES.topup)
    expect(names).toContain(MCP_TOOL_NAMES.createCheckoutSession)
    expect(names).toContain(MCP_TOOL_NAMES.activatePlan)
  })

  it('stamps icons from branding on every tool when provided', () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
      branding: { iconUrl: 'https://cdn.example.com/icon.png' },
    })
    for (const tool of tools) {
      expect(tool.icons).toEqual([
        { src: 'https://cdn.example.com/icon.png', sizes: ['any', '512x512'] },
      ])
    }
  })

  it('pins exact annotations per tool', () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })
    const byName = Object.fromEntries(tools.map(t => [t.name, t.annotations]))
    expect(byName[MCP_TOOL_NAMES.upgrade]).toEqual({
      openWorldHint: true,
      readOnlyHint: true,
      idempotentHint: true,
    })
    expect(byName[MCP_TOOL_NAMES.processPayment]).toEqual({
      openWorldHint: true,
      destructiveHint: true,
    })
    expect(byName[MCP_TOOL_NAMES.cancelRenewal]).toEqual({
      openWorldHint: true,
      destructiveHint: true,
      idempotentHint: true,
    })
    expect(byName[MCP_TOOL_NAMES.reactivateRenewal]).toEqual({
      openWorldHint: true,
      idempotentHint: true,
    })
    expect(byName[MCP_TOOL_NAMES.createCheckoutSession]).toEqual({ openWorldHint: true })
    expect(byName[MCP_TOOL_NAMES.activatePlan]).toEqual({ openWorldHint: true })
  })

  it('emits tools in registration order (intent → transport → activate_plan)', () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })
    expect(tools.map(t => t.name)).toEqual([
      MCP_TOOL_NAMES.upgrade,
      MCP_TOOL_NAMES.manageAccount,
      MCP_TOOL_NAMES.topup,
      MCP_TOOL_NAMES.createCheckoutSession,
      MCP_TOOL_NAMES.createPayment,
      MCP_TOOL_NAMES.processPayment,
      MCP_TOOL_NAMES.createCustomerSession,
      MCP_TOOL_NAMES.createTopupPayment,
      MCP_TOOL_NAMES.attachBusinessDetails,
      MCP_TOOL_NAMES.cancelRenewal,
      MCP_TOOL_NAMES.reactivateRenewal,
      MCP_TOOL_NAMES.activatePlan,
    ])
  })

  it('auto-includes apiBaseUrl origin in resourceDomains + connectDomains', () => {
    const { resource } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
      apiBaseUrl: 'https://api-dev.solvapay.com',
    })
    expect(resource.csp.resourceDomains).toContain('https://api-dev.solvapay.com')
    expect(resource.csp.connectDomains).toContain('https://api-dev.solvapay.com')
    // Baseline Stripe origins stay intact.
    expect(resource.csp.resourceDomains).toContain('https://js.stripe.com')
    expect(resource.csp.connectDomains).toContain('https://api.stripe.com')
  })

  it('apiBaseUrl is normalised to origin (strips path + trailing slash)', () => {
    const { resource } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
      apiBaseUrl: 'https://api.solvapay.com/v1/',
    })
    expect(resource.csp.resourceDomains).toContain('https://api.solvapay.com')
    expect(resource.csp.resourceDomains).not.toContain('https://api.solvapay.com/v1/')
  })

  it('apiBaseUrl auto-include dedupes against integrator-supplied csp overrides', () => {
    const { resource } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
      apiBaseUrl: 'https://api.solvapay.com',
      csp: {
        resourceDomains: ['https://api.solvapay.com', 'https://assets.merchant.test'],
      },
    })
    const occurrences = resource.csp.resourceDomains.filter(d => d === 'https://api.solvapay.com')
    expect(occurrences).toHaveLength(1)
    expect(resource.csp.resourceDomains).toContain('https://assets.merchant.test')
  })

  it('omitting apiBaseUrl leaves CSP untouched (backward compat)', () => {
    const { resource } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })
    expect(resource.csp.resourceDomains.some(d => d.includes('solvapay.com'))).toBe(false)
    expect(resource.csp.connectDomains.some(d => d.includes('solvapay.com'))).toBe(false)
  })
})

describe('buildSolvaPayDescriptors → bootstrap payload', () => {
  async function invokeOpen(
    toolName: string,
    overrides: MakeSolvaPayOverrides = {},
    extra?: Parameters<ReturnType<typeof buildSolvaPayDescriptors>['tools'][number]['handler']>[1],
  ) {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(overrides),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })
    const tool = tools.find(t => t.name === toolName)
    if (!tool) throw new Error(`tool ${toolName} not registered`)
    return tool.handler({}, extra)
  }

  it('includes merchant, product, plans on every intent bootstrap', async () => {
    const result = await invokeOpen(MCP_TOOL_NAMES.upgrade)
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.view).toBe('checkout')
    expect(sc.productRef).toBe('prd_test')
    expect(sc.merchant).toMatchObject({ displayName: 'Acme' })
    expect(sc.product).toMatchObject({ reference: 'prd_test' })
    expect(sc.plans).toEqual([{ reference: 'pln_basic', name: 'Basic' }])
  })

  it('omits customer snapshot when unauthenticated', async () => {
    const result = await invokeOpen(MCP_TOOL_NAMES.upgrade)
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.customer).toBeNull()
  })

  it('includes customer snapshot when customer_ref is on authInfo', async () => {
    const result = await invokeOpen(
      MCP_TOOL_NAMES.manageAccount,
      {
        customer: {
          customerRef: 'cus_42',
          externalRef: 'cus_42',
          email: 'a@b.test',
          purchases: [{ reference: 'pur_1', status: 'active', productRef: 'prd_test' }],
        },
        balance: {
          customerRef: 'cus_42',
          credits: 500,
          displayCurrency: 'USD',
          creditsPerMinorUnit: 1,
          displayExchangeRate: 1,
        },
        paymentMethod: { kind: 'card', brand: 'visa', last4: '4242' },
      },
      { authInfo: { extra: { customer_ref: 'cus_42' } } },
    )
    const sc = result.structuredContent as Record<string, unknown>
    const customer = sc.customer as Record<string, unknown>
    expect(customer).not.toBeNull()
    expect(customer.ref).toBe('cus_42')
    expect((customer.purchase as Record<string, unknown>).customerRef).toBe('cus_42')
    expect(customer.paymentMethod).toMatchObject({ kind: 'card', last4: '4242' })
    expect(customer.balance).toMatchObject({ credits: 500, displayCurrency: 'USD' })
    expect(customer.usage).not.toBeUndefined()
  })

  it('defaults plans to [] if list_plans errors', async () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: createSolvaPay({
        apiClient: {
          checkLimits: vi
            .fn()
            .mockResolvedValue({ withinLimits: true, remaining: 1, plan: 'free' }),
          trackUsage: vi.fn(),
          createCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus' }),
          getCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus' }),
          getPlatformConfig: vi.fn().mockResolvedValue({ stripePublishableKey: null }),
          getMerchant: vi.fn().mockResolvedValue({ displayName: 'M', legalName: 'L' }),
          getProduct: vi.fn().mockResolvedValue({ reference: 'prd_test' }),
          listPlans: vi.fn().mockRejectedValue(new Error('boom')),
        } as unknown as SolvaPayClient,
      }),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })
    const open = tools.find(t => t.name === MCP_TOOL_NAMES.upgrade)!
    const result = await open.handler({}, {})
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.plans).toEqual([])
  })

  it('activate_plan without planRef returns the picker bootstrap (view: checkout)', async () => {
    const result = await invokeOpen(MCP_TOOL_NAMES.activatePlan, {}, undefined)
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.view).toBe('checkout')
    expect(sc.plans).toBeTruthy()
  })

  it('returns a recovery-oriented tool error when getMerchant 404s', async () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: createSolvaPay({
        apiClient: {
          checkLimits: vi
            .fn()
            .mockResolvedValue({ withinLimits: true, remaining: 1, plan: 'free' }),
          trackUsage: vi.fn(),
          createCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus' }),
          getCustomer: vi.fn().mockResolvedValue({ customerRef: 'cus' }),
          getPlatformConfig: vi.fn().mockResolvedValue({ stripePublishableKey: null }),
          // Mimic the live SDK: getMerchant throws a SolvaPayError with status: 404
          getMerchant: vi.fn().mockImplementation(async () => {
            const { SolvaPayError } = await import('@solvapay/core')
            throw new SolvaPayError('Get merchant failed (404): Provider not found', {
              status: 404,
            })
          }),
          getProduct: vi
            .fn()
            .mockResolvedValue({ reference: 'prd_test', name: 'Test product' }),
          listPlans: vi.fn().mockResolvedValue([{ reference: 'pln_basic', name: 'Basic' }]),
        } as unknown as SolvaPayClient,
      }),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })
    const upgrade = tools.find(t => t.name === MCP_TOOL_NAMES.upgrade)!
    const result = await upgrade.handler({}, {})

    expect(result.isError).toBe(true)
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.status).toBe(404)
    const text = (result.content as Array<{ text?: string }>)?.[0]?.text ?? ''
    // The recovery text must mention the next step and not be a JSON dump.
    expect(text).toMatch(/Provider/i)
    expect(text).toMatch(/solvapay init/)
    // Make sure we did not stringify a JSON envelope into content[0].text.
    expect(text.trim().startsWith('{')).toBe(false)
  })

  it('activate_plan without planRef errors when checkout view is disabled', async () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
      views: ['account'],
    })
    const activate = tools.find(t => t.name === MCP_TOOL_NAMES.activatePlan)!
    const result = await activate.handler({}, {})
    expect(result.isError).toBe(true)
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.status).toBe(400)
    expect(String(sc.error)).toMatch(/planRef/)
  })
})

// Workaround coverage for the ChatGPT MCP connector's stale link_<id>
// routing bug — see the top-of-file comment in
// packages/mcp-core/src/descriptors.ts and the OpenAI Apps SDK
// community thread cited there.
describe('buildSolvaPayDescriptors → _meta["openai/widgetSessionId"] stamping', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const WIDGET_KEY = 'openai/widgetSessionId'

  function buildBundle() {
    return buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })
  }

  function metaKey(result: { _meta?: Record<string, unknown> }): string | undefined {
    const value = result._meta?.[WIDGET_KEY]
    return typeof value === 'string' ? value : undefined
  }

  it.each([MCP_TOOL_NAMES.topup, MCP_TOOL_NAMES.upgrade, MCP_TOOL_NAMES.manageAccount])(
    '%s stamps a fresh UUID per invocation',
    async toolName => {
      const { tools } = buildBundle()
      const tool = tools.find(t => t.name === toolName)!

      const first = await tool.handler({}, {})
      const second = await tool.handler({}, {})

      const firstId = metaKey(first)
      const secondId = metaKey(second)
      expect(firstId).toMatch(UUID_RE)
      expect(secondId).toMatch(UUID_RE)
      expect(firstId).not.toBe(secondId)
    },
  )

  it("preserves widgetSessionId when mode: 'text' strips _meta.ui", async () => {
    const { tools } = buildBundle()
    const upgrade = tools.find(t => t.name === MCP_TOOL_NAMES.upgrade)!
    const result = await upgrade.handler({ mode: 'text' }, {})
    expect(metaKey(result)).toMatch(UUID_RE)
    // ui ref must be stripped in text mode (existing contract).
    expect((result._meta as Record<string, unknown> | undefined)?.ui).toBeUndefined()
  })

  it('activate_plan picker bootstrap stamps widgetSessionId', async () => {
    const { tools } = buildBundle()
    const activate = tools.find(t => t.name === MCP_TOOL_NAMES.activatePlan)!
    const result = await activate.handler({}, {})
    expect(metaKey(result)).toMatch(UUID_RE)
  })
})

describe('deriveIcons', () => {
  it('returns undefined when branding is absent', () => {
    expect(deriveIcons(undefined)).toBeUndefined()
  })

  it('returns undefined when branding has neither icon nor logo', () => {
    expect(deriveIcons({ brandName: 'Acme' })).toBeUndefined()
  })

  it('prefers iconUrl with sizes any + 512x512', () => {
    expect(
      deriveIcons({
        iconUrl: 'https://cdn.example.com/icon.png',
        logoUrl: 'https://cdn.example.com/logo.png',
      }),
    ).toEqual([{ src: 'https://cdn.example.com/icon.png', sizes: ['any', '512x512'] }])
  })

  it('falls back to logoUrl without sizes', () => {
    expect(deriveIcons({ logoUrl: 'https://cdn.example.com/logo.png' })).toEqual([
      { src: 'https://cdn.example.com/logo.png' },
    ])
  })
})

describe('TOOL_FOR_VIEW / VIEW_FOR_TOOL', () => {
  it('maps each view to its intent tool and inverts cleanly', () => {
    expect(TOOL_FOR_VIEW).toEqual({
      checkout: 'upgrade',
      account: 'manage_account',
      topup: 'topup',
    })
    expect(VIEW_FOR_TOOL).toEqual({
      upgrade: 'checkout',
      manage_account: 'account',
      topup: 'topup',
    })
    expect(OPEN_TOOL_FOR_VIEW).toBe(TOOL_FOR_VIEW)
    expect(VIEW_FOR_OPEN_TOOL).toBe(VIEW_FOR_TOOL)
  })
})

describe('buildSolvaPayPrompts', () => {
  it('emits all four prompts when every view is enabled', () => {
    const prompts = buildSolvaPayPrompts()
    expect(prompts.map(p => p.name)).toEqual([
      MCP_TOOL_NAMES.upgrade,
      MCP_TOOL_NAMES.manageAccount,
      MCP_TOOL_NAMES.topup,
      MCP_TOOL_NAMES.activatePlan,
    ])
  })

  it('drops upgrade + activate_plan prompts when checkout is disabled', () => {
    const prompts = buildSolvaPayPrompts({
      enabledViews: new Set(['account', 'topup']),
    })
    expect(prompts.map(p => p.name)).toEqual([
      MCP_TOOL_NAMES.manageAccount,
      MCP_TOOL_NAMES.topup,
    ])
  })

  it('renders exact user-message text with and without args', async () => {
    const prompts = buildSolvaPayPrompts()
    const byName = Object.fromEntries(prompts.map(p => [p.name, p]))

    expect(await byName[MCP_TOOL_NAMES.upgrade]!.handler({ planRef: 'pln_pro' })).toEqual({
      messages: [
        { role: 'user', content: { type: 'text', text: 'Activate plan pln_pro for me.' } },
      ],
    })
    expect(await byName[MCP_TOOL_NAMES.upgrade]!.handler({})).toEqual({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: 'Show me the upgrade options for my SolvaPay account.' },
        },
      ],
    })
    expect(await byName[MCP_TOOL_NAMES.manageAccount]!.handler({})).toEqual({
      messages: [
        { role: 'user', content: { type: 'text', text: 'Show me my SolvaPay account.' } },
      ],
    })
    expect(await byName[MCP_TOOL_NAMES.topup]!.handler({ amount: '10' })).toEqual({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: 'Top up my SolvaPay credits by 10.' },
        },
      ],
    })
    expect(await byName[MCP_TOOL_NAMES.topup]!.handler({})).toEqual({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: 'I want to top up my SolvaPay credits.' },
        },
      ],
    })
    expect(await byName[MCP_TOOL_NAMES.activatePlan]!.handler({ planRef: 'pln_free' })).toEqual({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: 'Activate plan pln_free on my SolvaPay account.' },
        },
      ],
    })
    expect(await byName[MCP_TOOL_NAMES.activatePlan]!.handler({})).toEqual({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: 'What plans can I activate on my SolvaPay account?' },
        },
      ],
    })
  })
})

describe('create_payment_intent descriptor', () => {
  it('forwards optional currency to createPaymentIntentCore', async () => {
    const serverModule = await import('@solvapay/server')
    const coreSpy = vi.spyOn(serverModule, 'createPaymentIntentCore').mockResolvedValue({
      clientSecret: 'cs_test',
      publishableKey: 'pk_test',
      customerRef: 'cus_test',
    })

    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })
    const tool = tools.find(t => t.name === MCP_TOOL_NAMES.createPayment)
    expect(tool).toBeTruthy()

    await tool!.handler(
      { planRef: 'pln_pro', productRef: 'prd_test', currency: 'EUR' },
      { authInfo: { extra: { customer_ref: 'cus_test' } } },
    )

    expect(coreSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        planRef: 'pln_pro',
        productRef: 'prd_test',
        currency: 'EUR',
      }),
      expect.anything(),
    )

    coreSpy.mockRestore()
  })
})
