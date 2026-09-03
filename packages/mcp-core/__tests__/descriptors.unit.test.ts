/**
 * Snapshot-style shape test for `buildSolvaPayDescriptors`. Guards the
 * tool list, names, descriptions, and meta envelope so the contract
 * doesn't silently drift between framework adapters.
 */

import { describe, expect, it, vi } from 'vitest'
import { createSolvaPay, type SolvaPayClient } from '@solvapay/server'
import {
  buildSolvaPayDescriptors,
  INTENT_TOOL_NAMES,
  MCP_PROMPT_NAMES,
  MCP_TOOL_NAMES,
  VIEWER_TOOL_NAME,
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
    createCheckoutSession: vi.fn().mockResolvedValue({
      sessionId: 'sess_test',
      checkoutUrl: 'https://customer.solvapay.com/demo?session=sess_test',
    }),
    createCustomerSession: vi.fn().mockResolvedValue({
      sessionId: 'csess_test',
      customerUrl: 'https://customer.solvapay.com/portal?session=csess_test',
    }),
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
        MCP_TOOL_NAMES.createHostedSession,
        MCP_TOOL_NAMES.createPayment,
        VIEWER_TOOL_NAME,
        MCP_TOOL_NAMES.processPayment,
        MCP_TOOL_NAMES.setRenewal,
      ].sort(),
    )

    for (const tool of tools) {
      expect(tool.description).toBeTypeOf('string')
      expect(tool.description.length).toBeGreaterThan(10)
      expect(tool.handler).toBeTypeOf('function')
      if (tool.name !== MCP_TOOL_NAMES.activatePlan) {
        expect(tool.meta).toMatchObject({ ui: { resourceUri: 'ui://test/view.html' } })
      }
    }

    // Intent tools (LLM-callable, dual-audience) carry the plain
    // `{ ui: { resourceUri } }` meta with no audience tag.
    const viewer = tools.find(t => t.name === VIEWER_TOOL_NAME)
    expect(viewer).toBeTruthy()
    expect((viewer!.meta as Record<string, unknown>).audience).toBeUndefined()
    const viewerVisibility = (viewer!.meta as { ui?: { visibility?: readonly string[] } }).ui
      ?.visibility
    expect(viewerVisibility).not.toEqual(['app'])
    expect((viewer!.meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBe(
      'ui://test/view.html',
    )

    const activate = tools.find(t => t.name === MCP_TOOL_NAMES.activatePlan)
    expect(activate).toBeTruthy()
    expect((activate!.meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBeUndefined()
    expect((activate!.meta as Record<string, unknown>)['openai/widgetAccessible']).toBe(true)
    expect((activate!.meta as { ui?: { visibility?: readonly string[] } }).ui?.visibility).not.toEqual(
      ['app'],
    )

    // UI-transport tools (state-change, no LLM use) all tag themselves.
    const uiOnlyTools = [
      MCP_TOOL_NAMES.attachBusinessDetails,
      MCP_TOOL_NAMES.createPayment,
      MCP_TOOL_NAMES.processPayment,
      MCP_TOOL_NAMES.createHostedSession,
      MCP_TOOL_NAMES.setRenewal,
    ]
    for (const name of uiOnlyTools) {
      const tool = tools.find(t => t.name === name)
      expect(tool).toBeTruthy()
      expect((tool!.meta as Record<string, unknown>).audience).toBe('ui')
      expect((tool!.meta as { ui?: { visibility?: readonly string[] } }).ui?.visibility).toEqual([
        'app',
      ])
      expect((tool!.meta as Record<string, unknown>)['openai/widgetAccessible']).toBe(true)
      // ChatGPT resolves model visibility from this legacy string, whose
      // default is 'public' — without it every transport tool lands in the
      // model's tool list regardless of `ui.visibility`.
      expect((tool!.meta as Record<string, unknown>)['openai/visibility']).toBe('private')
      expect(tool!.description).toMatch(/UI-only/i)
    }

    expect(resource.uri).toBe('ui://test/view.html')
    expect(resource.mimeType).toBe('text/html;profile=mcp-app')
    expect(resource.readHtml).toBeTypeOf('function')
    expect(resource.csp.resourceDomains).toContain('https://js.stripe.com')
  })

  it('marks the viewer intent tool as read-only', () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })

    const tool = tools.find(t => t.name === VIEWER_TOOL_NAME)!
    expect(tool.annotations).toMatchObject({
      openWorldHint: true,
      readOnlyHint: true,
      idempotentHint: true,
    })
    expect(tool.annotations?.destructiveHint).toBeUndefined()

    const activate = tools.find(t => t.name === MCP_TOOL_NAMES.activatePlan)!
    expect(activate.annotations?.readOnlyHint).toBe(false)
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

  it('filters the viewer view enum by views option without dropping the tool', async () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
      views: ['checkout'],
    })
    const names = tools.map(t => t.name)
    expect(names).toContain(VIEWER_TOOL_NAME)
    const viewer = tools.find(t => t.name === VIEWER_TOOL_NAME)!
    const allowed = await viewer.handler({ view: 'checkout' }, {})
    expect(allowed.isError).not.toBe(true)
    const blocked = await viewer.handler({ view: 'account' }, {})
    expect(blocked.isError).toBe(true)
    const sc = blocked.structuredContent as Record<string, unknown>
    expect(sc.status).toBe(400)
  })

  it('rejects non-http publicBaseUrl', () => {
    expect(() =>
      buildSolvaPayDescriptors({
        solvaPay: makeSolvaPay(),
        productRef: 'prd_test',
        resourceUri: 'ui://test/view.html',
        readHtml: async () => '<html></html>',
        publicBaseUrl: 'ui://nope',
      }),
    ).toThrow(/http\(s\)/)
  })

  it('rejects empty productRef', () => {
    expect(() =>
      buildSolvaPayDescriptors({
        solvaPay: makeSolvaPay(),
        productRef: '',
        resourceUri: 'ui://test/view.html',
        readHtml: async () => '<html></html>',
        publicBaseUrl: 'https://example.com',
      }),
    ).toThrow(/productRef is required/)
  })

  it('rejects scaffolder placeholder productRef', () => {
    expect(() =>
      buildSolvaPayDescriptors({
        solvaPay: makeSolvaPay(),
        productRef: '__SOLVAPAY_PRODUCT_REF__',
        resourceUri: 'ui://test/view.html',
        readHtml: async () => '<html></html>',
        publicBaseUrl: 'https://example.com',
      }),
    ).toThrow(/scaffolder placeholder/)
  })

  it('rejects non-prd_ productRef shape', () => {
    expect(() =>
      buildSolvaPayDescriptors({
        solvaPay: makeSolvaPay(),
        productRef: 'product-1',
        resourceUri: 'ui://test/view.html',
        readHtml: async () => '<html></html>',
        publicBaseUrl: 'https://example.com',
      }),
    ).toThrow(/prd_/)
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
    args: Record<string, unknown> = {},
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
    return tool.handler(args, extra)
  }

  it('includes merchant, product, plans on every intent bootstrap', async () => {
    const result = await invokeOpen(VIEWER_TOOL_NAME, {}, undefined, { view: 'checkout' })
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.view).toBe('checkout')
    expect(sc.productRef).toBe('prd_test')
    expect(sc.merchant).toMatchObject({ displayName: 'Acme' })
    expect(sc.product).toMatchObject({ reference: 'prd_test' })
    expect(sc.plans).toEqual([{ reference: 'pln_basic', name: 'Basic' }])
  })

  it('omits customer snapshot when unauthenticated', async () => {
    const result = await invokeOpen(VIEWER_TOOL_NAME, {}, undefined, { view: 'checkout' })
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.customer).toBeNull()
    // Text hosts still need a pasteable checkout URL without a signed-in
    // customer — mint against the anonymous ref, same as the paywall.
    expect(sc.checkoutUrl).toBe('https://customer.solvapay.com/demo?session=sess_test')
    expect(sc.portalUrl).toBeNull()
  })

  it('includes customer snapshot when customer_ref is on authInfo', async () => {
    const result = await invokeOpen(
      VIEWER_TOOL_NAME,
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
      { view: 'account' },
    )
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.view).toBe('account')
    const customer = sc.customer as Record<string, unknown>
    expect(customer).not.toBeNull()
    expect(customer.ref).toBe('cus_42')
    expect((customer.purchase as Record<string, unknown>).customerRef).toBe('cus_42')
    expect(customer.paymentMethod).toMatchObject({ kind: 'card', last4: '4242' })
    expect(customer.balance).toMatchObject({ credits: 500, displayCurrency: 'USD' })
    expect(customer.usage).not.toBeUndefined()
    expect(sc.checkoutUrl).toBe('https://customer.solvapay.com/demo?session=sess_test')
    expect(sc.portalUrl).toBe('https://customer.solvapay.com/portal?session=csess_test')
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
    const open = tools.find(t => t.name === VIEWER_TOOL_NAME)!
    const result = await open.handler({ view: 'checkout' }, {})
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.plans).toEqual([])
  })

  it('activate_plan without planRef returns 400', async () => {
    const result = await invokeOpen(MCP_TOOL_NAMES.activatePlan, {}, undefined, {})
    expect(result.isError).toBe(true)
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.status).toBe(400)
    expect(String(sc.error)).toMatch(/planRef/)
  })

  it('account without view derives checkout for unauthenticated callers', async () => {
    const result = await invokeOpen(VIEWER_TOOL_NAME)
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.view).toBe('checkout')
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
    const viewer = tools.find(t => t.name === VIEWER_TOOL_NAME)!
    const result = await viewer.handler({ view: 'checkout' }, {})

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

  it('account rejects a disabled view with 400', async () => {
    const { tools } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
      views: ['account'],
    })
    const viewer = tools.find(t => t.name === VIEWER_TOOL_NAME)!
    const result = await viewer.handler({ view: 'checkout' }, {})
    expect(result.isError).toBe(true)
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.status).toBe(400)
    expect(String(sc.error)).toMatch(/checkout/)
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

  it('account stamps a fresh UUID per invocation', async () => {
      const { tools } = buildBundle()
      const tool = tools.find(t => t.name === VIEWER_TOOL_NAME)!

      const first = await tool.handler({ view: 'checkout' }, {})
      const second = await tool.handler({ view: 'account' }, {})

      const firstId = metaKey(first)
      const secondId = metaKey(second)
      expect(firstId).toMatch(UUID_RE)
      expect(secondId).toMatch(UUID_RE)
      expect(firstId).not.toBe(secondId)
  })

  it("preserves widgetSessionId when mode: 'text' strips _meta.ui", async () => {
    const { tools } = buildBundle()
    const viewer = tools.find(t => t.name === VIEWER_TOOL_NAME)!
    const result = await viewer.handler({ mode: 'text', view: 'checkout' }, {})
    expect(metaKey(result)).toMatch(UUID_RE)
    // ui ref must be stripped in text mode (existing contract).
    expect((result._meta as Record<string, unknown> | undefined)?.ui).toBeUndefined()
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
      { purpose: 'plan', planRef: 'pln_pro', productRef: 'prd_test', currency: 'EUR' },
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

describe('buildSolvaPayDescriptors → intent-tool description contract', () => {
  function buildTools() {
    return buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    }).tools
  }

  const VIEWER_TRIGGERS = [
    'upgrade',
    'change plan',
    'buy',
    'subscribe',
    'my account',
    'current plan',
    'cancel',
    'billing',
    'top up',
    'add credits',
    'buy credits',
  ]

  it('leads each intent tool with trigger phrases and drops duplicated tails', () => {
    const tools = buildTools()
    for (const name of INTENT_TOOL_NAMES) {
      const tool = tools.find(t => t.name === name)
      expect(tool, name).toBeTruthy()
      const description = tool!.description
      expect(description).not.toMatch(/Also available/i)
      expect(description).not.toMatch(/On UI hosts/i)
      expect(description).not.toMatch(/Default `mode:/)
      if (name === VIEWER_TOOL_NAME) {
        for (const phrase of VIEWER_TRIGGERS) {
          expect(description.toLowerCase()).toContain(phrase)
        }
      } else {
        expect(description.toLowerCase()).toContain('activate')
      }
    }
  })

  it('puts MODE_HINT on the viewer mode param, not the tool description', () => {
    const tools = buildTools()
    const viewer = tools.find(t => t.name === VIEWER_TOOL_NAME)
    const mode = viewer?.inputSchema.mode
    expect(mode, 'account.inputSchema.mode').toBeTruthy()
    expect(mode!.description).toMatch(/mode: 'auto'/)
    expect(mode!.description).toMatch(/mode: 'text'/)
    expect(mode!.description).toMatch(/mode: 'ui'/)
    const activate = tools.find(t => t.name === MCP_TOOL_NAMES.activatePlan)
    expect(activate?.inputSchema.mode).toBeUndefined()
  })

  it('steers UI-only tools at every intent tool, including topup', () => {
    const tools = buildTools()
    const payment = tools.find(t => t.name === MCP_TOOL_NAMES.createPayment)
    expect(payment?.description).toMatch(/UI-only/)
    for (const name of INTENT_TOOL_NAMES) {
      expect(payment?.description).toContain(`\`${name}\``)
    }
  })

  it('advertises two intent tools on the overview resource', () => {
    const { docsResources } = buildSolvaPayDescriptors({
      solvaPay: makeSolvaPay(),
      productRef: 'prd_test',
      resourceUri: 'ui://test/view.html',
      readHtml: async () => '<html></html>',
      publicBaseUrl: 'https://example.com',
    })
    const overview = docsResources?.find(r => r.uri === 'docs://solvapay/overview.md')
    expect(overview?.description).toMatch(/two intent tools/)
    expect(overview?.description).not.toMatch(/five intent tools/)
  })
})
