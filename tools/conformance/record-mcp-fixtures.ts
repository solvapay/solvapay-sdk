/**
 * Throwaway recorder: drive live TypeScript MCP handlers and write
 * contract/mcp-fixtures/{builtin-tools,narrate,oauth-proxy,dispatch}.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  narrateActivatePlan,
  narrateManageAccount,
  narrateTopup,
  narrateUpgrade,
  narratedToolResult,
  toolErrorResult,
  toolResult,
  uiPlaceholder,
  type BootstrapPayload,
} from '../../sdks/typescript/mcp-core/src/index.ts'
import { createOAuthFetchRouter } from '../../sdks/typescript/mcp/src/fetch/oauth-bridge.ts'

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../contract/mcp-fixtures',
)

function writeFixture(rel: string, body: unknown): void {
  const full = path.join(root, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, `${JSON.stringify(body, null, 2)}\n`)
  process.stdout.write(`wrote ${rel}\n`)
}

const cycle = (interval = 'month') => ({ kind: 'billingCycle', interval })
const flat = (amountMinor: number, currency = 'usd') => ({
  kind: 'charge',
  per: 'flat',
  amountMinor,
  currency,
})

function basePayload(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  return {
    view: 'account',
    productRef: 'prd_x',
    stripePublishableKey: null,
    returnUrl: 'https://example.test/r',
    merchant: { displayName: 'Acme', legalName: 'Acme Inc.' } as never,
    product: { reference: 'prd_x', name: 'Acme Knowledge Base' } as never,
    plans: [],
    customer: null,
    ...overrides,
  }
}

const usdBalance = {
  credits: 5000,
  displayCurrency: 'USD',
  displayExchangeRate: 1,
  creditsPerMinorUnit: 100,
}

const config = {
  productRef: 'prd_demo',
  publicBaseUrl: 'https://app.example.com',
  resourceUri: 'ui://test/view.html',
}

function recordNarrate(): void {
  const cold = basePayload({
    plans: [
      { type: 'recurring', name: 'Free', requiresPayment: false, options: [cycle(), flat(0)] },
      {
        type: 'recurring',
        name: 'Unlimited',
        price: 50000,
        currency: 'USD',
        requiresPayment: true,
        options: [cycle(), flat(50000)],
      },
    ] as never,
  })
  writeFixture('narrate/manage-account.json', {
    suite: 'narrate',
    case: 'manage-account',
    input: { fn: 'mcpNarrate', args: { tool: 'manage_account', payload: cold } },
    expect: { result: narrateManageAccount(cold) },
  })

  const active = basePayload({
    customer: {
      ref: 'cus_1',
      purchase: {
        customerRef: 'cus_1',
        purchases: [
          {
            planSnapshot: {
              name: 'Unlimited',
              isMetered: false,
              price: 50000,
              currency: 'USD',
              options: [cycle(), flat(50000)],
            },
            billingCycle: 'monthly',
            endDate: '2026-05-01T00:00:00Z',
          },
        ],
      } as never,
      paymentMethod: null,
      balance: { ...usdBalance, credits: 100 } as never,
      usage: null,
    } as never,
  })
  writeFixture('narrate/manage-account-active.json', {
    suite: 'narrate',
    case: 'manage-account-active',
    input: { fn: 'mcpNarrate', args: { tool: 'manage_account', payload: active } },
    expect: { result: narrateManageAccount(active) },
  })

  const upgradePayload = basePayload({
    view: 'checkout',
    plans: [
      { type: 'recurring', name: 'Free', requiresPayment: false, options: [cycle(), flat(0)] },
      {
        type: 'recurring',
        name: 'Pro',
        requiresPayment: true,
        options: [cycle(), flat(20000)],
      },
    ] as never,
  })
  writeFixture('narrate/upgrade.json', {
    suite: 'narrate',
    case: 'upgrade',
    input: { fn: 'mcpNarrate', args: { tool: 'upgrade', payload: upgradePayload } },
    expect: { result: narrateUpgrade(upgradePayload) },
  })

  const topupPayload = basePayload({
    customer: {
      ref: 'cus_1',
      purchase: null,
      paymentMethod: null,
      balance: { ...usdBalance, credits: 865_500 } as never,
      usage: null,
    } as never,
  })
  writeFixture('narrate/topup.json', {
    suite: 'narrate',
    case: 'topup',
    input: { fn: 'mcpNarrate', args: { tool: 'topup', payload: topupPayload } },
    expect: { result: narrateTopup(topupPayload) },
  })

  const activatePayload = basePayload({
    plans: [
      { type: 'recurring', name: 'Free', requiresPayment: false, options: [cycle()] },
      {
        type: 'usage-based',
        name: 'Starter',
        requiresPayment: true,
        options: [
          { kind: 'charge', per: 'unit', amountMinor: 1, currency: 'usd', meter: 'requests' },
        ],
      },
    ] as never,
  })
  writeFixture('narrate/activate-plan.json', {
    suite: 'narrate',
    case: 'activate-plan',
    input: { fn: 'mcpNarrate', args: { tool: 'activate_plan', payload: activatePayload } },
    expect: { result: narrateActivatePlan(activatePayload) },
  })

  writeFixture('narrate/placeholder.json', {
    suite: 'narrate',
    case: 'placeholder',
    input: {
      fn: 'mcpNarrate',
      args: { tool: 'manage_account', payload: active, kind: 'placeholder' },
    },
    expect: { result: { text: uiPlaceholder('manage_account', active) } },
  })

  const meta = {
    ui: { resourceUri: 'ui://x' },
    'openai/widgetSessionId': '00000000-0000-4000-8000-000000000001',
  }
  for (const mode of ['ui', 'text', 'auto'] as const) {
    writeFixture(`narrate/mode-${mode}.json`, {
      suite: 'narrate',
      case: `mode-${mode}`,
      input: {
        fn: 'mcpNarrate',
        args: { tool: 'manage_account', payload: active, mode, meta },
      },
      expect: { result: narratedToolResult('manage_account', active, mode, meta) },
    })
  }
}

function unauth(): unknown {
  return toolErrorResult({
    error: 'Unauthorized',
    status: 401,
    details: 'customer_ref missing from MCP auth context',
  })
}

function recordBuiltins(): void {
  const tools = [
    'create_checkout_session',
    'create_payment_intent',
    'process_payment',
    'create_customer_session',
    'create_topup_payment_intent',
    'attach_business_details',
    'cancel_renewal',
    'reactivate_renewal',
  ] as const
  for (const name of tools) {
    writeFixture(`builtin-tools/${name.replace(/_/g, '-')}-unauth.json`, {
      suite: 'builtin-tools',
      case: `${name}-unauth`,
      input: {
        fn: 'mcpCallBuiltinTool',
        args: { name, args: {}, config, customerRef: null },
      },
      expect: { result: unauth() },
    })
  }

  writeFixture('builtin-tools/create-checkout-session.json', {
    suite: 'builtin-tools',
    case: 'create-checkout-session',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'create_checkout_session',
        args: { planRef: 'pln_pro' },
        config,
        customerRef: 'cus_1',
      },
    },
    http: [
      {
        method: 'POST',
        path: '/v1/sdk/checkout-sessions',
        status: 200,
        body: { url: 'https://checkout.example/s', id: 'cs_1' },
      },
    ],
    expect: { result: toolResult({ url: 'https://checkout.example/s', id: 'cs_1' }) },
  })

  writeFixture('builtin-tools/create-customer-session.json', {
    suite: 'builtin-tools',
    case: 'create-customer-session',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: { name: 'create_customer_session', args: {}, config, customerRef: 'cus_1' },
    },
    http: [
      {
        method: 'POST',
        path: '/v1/sdk/customers/customer-sessions',
        status: 200,
        body: { url: 'https://portal.example/s' },
      },
    ],
    expect: { result: toolResult({ url: 'https://portal.example/s' }) },
  })

  writeFixture('builtin-tools/create-payment-intent.json', {
    suite: 'builtin-tools',
    case: 'create-payment-intent',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'create_payment_intent',
        args: { planRef: 'pln_pro', productRef: 'prd_demo' },
        config,
        customerRef: 'cus_1',
      },
    },
    http: [
      {
        method: 'POST',
        path: '/v1/sdk/payment-intents',
        status: 200,
        body: { clientSecret: 'sec_1', publishableKey: 'pk_test' },
      },
    ],
    expect: { result: toolResult({ clientSecret: 'sec_1', publishableKey: 'pk_test' }) },
  })

  writeFixture('builtin-tools/process-payment.json', {
    suite: 'builtin-tools',
    case: 'process-payment',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'process_payment',
        args: { paymentIntentId: 'pi_1', productRef: 'prd_demo' },
        config,
        customerRef: 'cus_1',
      },
    },
    http: [
      {
        method: 'POST',
        path: '/v1/sdk/payment-intents/pi_1/process',
        status: 200,
        body: { status: 'succeeded', message: 'ok' },
      },
    ],
    expect: { result: toolResult({ status: 'succeeded', message: null }) },
  })

  writeFixture('builtin-tools/create-topup-payment-intent.json', {
    suite: 'builtin-tools',
    case: 'create-topup-payment-intent',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'create_topup_payment_intent',
        args: { amount: 1000, currency: 'USD' },
        config,
        customerRef: 'cus_1',
      },
    },
    http: [
      {
        method: 'POST',
        path: '/v1/sdk/payment-intents',
        status: 200,
        body: {
          clientSecret: 'sec_t',
          processorPaymentId: 'pi_t',
          publishableKey: 'pk_test',
        },
      },
    ],
    expect: {
      result: toolResult({
        clientSecret: 'sec_t',
        processorPaymentId: 'pi_t',
        publishableKey: 'pk_test',
      }),
    },
  })

  writeFixture('builtin-tools/attach-business-details.json', {
    suite: 'builtin-tools',
    case: 'attach-business-details',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'attach_business_details',
        args: { paymentIntentId: 'pi_1', isBusiness: true, country: 'DE' },
        config,
        customerRef: 'cus_1',
      },
    },
    http: [
      {
        method: 'POST',
        path: '/v1/sdk/payment-intents/pi_1/business-details',
        status: 200,
        body: { tax: { amount: 19 } },
      },
    ],
    expect: { result: toolResult({ tax: { amount: 19 } }) },
  })

  writeFixture('builtin-tools/cancel-renewal.json', {
    suite: 'builtin-tools',
    case: 'cancel-renewal',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'cancel_renewal',
        args: { purchaseRef: 'pur_1' },
        config,
        customerRef: 'cus_1',
      },
    },
    http: [
      {
        method: 'POST',
        path: '/v1/sdk/purchases/pur_1/cancel',
        status: 200,
        body: { reference: 'pur_1', status: 'cancelled' },
      },
    ],
    expect: { result: toolResult({ reference: 'pur_1', status: 'cancelled' }) },
  })

  writeFixture('builtin-tools/reactivate-renewal.json', {
    suite: 'builtin-tools',
    case: 'reactivate-renewal',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'reactivate_renewal',
        args: { purchaseRef: 'pur_1' },
        config,
        customerRef: 'cus_1',
      },
    },
    http: [
      {
        method: 'POST',
        path: '/v1/sdk/purchases/pur_1/reactivate',
        status: 200,
        body: { reference: 'pur_1', status: 'active', cancelledAt: null },
      },
    ],
    expect: { result: toolResult({ reference: 'pur_1', status: 'active', cancelledAt: null }) },
  })

  writeFixture('builtin-tools/activate-plan.json', {
    suite: 'builtin-tools',
    case: 'activate-plan',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'activate_plan',
        args: { planRef: 'pln_pro', productRef: 'prd_demo' },
        config,
        customerRef: 'cus_1',
      },
    },
    http: [
      {
        method: 'POST',
        path: '/v1/sdk/activate',
        status: 200,
        body: { status: 'active', planRef: 'pln_pro' },
      },
    ],
    expect: { result: toolResult({ status: 'active', planRef: 'pln_pro' }) },
  })

  const pickerPayload = {
    view: 'checkout',
    productRef: 'prd_demo',
    stripePublishableKey: 'pk_test',
    returnUrl: 'https://app.example.com',
    merchant: { displayName: 'Acme' },
    product: { name: 'Demo' },
    plans: [{ name: 'Pro' }],
    customer: null,
  }
  const pickerMeta = {
    'openai/widgetSessionId': '00000000-0000-4000-8000-000000000001',
  }
  writeFixture('builtin-tools/activate-plan-no-ref.json', {
    suite: 'builtin-tools',
    case: 'activate-plan-no-ref',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'activate_plan',
        args: { mode: 'text' },
        config,
        customerRef: null,
        widgetSessionId: '00000000-0000-4000-8000-000000000001',
      },
    },
    http: [
      {
        method: 'GET',
        path: '/v1/sdk/platform-config',
        status: 200,
        body: { stripePublishableKey: 'pk_test' },
      },
      { method: 'GET', path: '/v1/sdk/merchant', status: 200, body: { displayName: 'Acme' } },
      { method: 'GET', path: '/v1/sdk/products/prd_demo', status: 200, body: { name: 'Demo' } },
      {
        method: 'GET',
        path: '/v1/sdk/products/prd_demo/plans',
        status: 200,
        body: { plans: [{ name: 'Pro' }] },
      },
    ],
    expect: {
      result: narratedToolResult('activate_plan', pickerPayload as never, 'text', pickerMeta),
    },
  })

  writeFixture('builtin-tools/manage-account.json', {
    suite: 'builtin-tools',
    case: 'manage-account',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'manage_account',
        args: { mode: 'text' },
        config,
        customerRef: null,
        widgetSessionId: '00000000-0000-4000-8000-000000000001',
      },
    },
    http: [
      {
        method: 'GET',
        path: '/v1/sdk/platform-config',
        status: 200,
        body: { stripePublishableKey: 'pk_test' },
      },
      { method: 'GET', path: '/v1/sdk/merchant', status: 200, body: { displayName: 'Acme' } },
      { method: 'GET', path: '/v1/sdk/products/prd_demo', status: 200, body: { name: 'Demo' } },
      {
        method: 'GET',
        path: '/v1/sdk/products/prd_demo/plans',
        status: 200,
        body: { plans: [{ name: 'Pro' }] },
      },
    ],
    expect: {
      result: narratedToolResult(
        'manage_account',
        { ...pickerPayload, view: 'account' } as never,
        'text',
        pickerMeta,
      ),
    },
  })

  writeFixture('builtin-tools/upgrade.json', {
    suite: 'builtin-tools',
    case: 'upgrade',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'upgrade',
        args: { mode: 'text' },
        config,
        customerRef: null,
        widgetSessionId: '00000000-0000-4000-8000-000000000001',
      },
    },
    http: [
      {
        method: 'GET',
        path: '/v1/sdk/platform-config',
        status: 200,
        body: { stripePublishableKey: 'pk_test' },
      },
      { method: 'GET', path: '/v1/sdk/merchant', status: 200, body: { displayName: 'Acme' } },
      { method: 'GET', path: '/v1/sdk/products/prd_demo', status: 200, body: { name: 'Demo' } },
      {
        method: 'GET',
        path: '/v1/sdk/products/prd_demo/plans',
        status: 200,
        body: { plans: [{ name: 'Pro' }] },
      },
    ],
    expect: {
      result: narratedToolResult(
        'upgrade',
        { ...pickerPayload, view: 'checkout' } as never,
        'text',
        pickerMeta,
      ),
    },
  })

  writeFixture('builtin-tools/topup.json', {
    suite: 'builtin-tools',
    case: 'topup',
    input: {
      fn: 'mcpCallBuiltinTool',
      args: {
        name: 'topup',
        args: { mode: 'text' },
        config,
        customerRef: null,
        widgetSessionId: '00000000-0000-4000-8000-000000000001',
      },
    },
    http: [
      {
        method: 'GET',
        path: '/v1/sdk/platform-config',
        status: 200,
        body: { stripePublishableKey: 'pk_test' },
      },
      { method: 'GET', path: '/v1/sdk/merchant', status: 200, body: { displayName: 'Acme' } },
      { method: 'GET', path: '/v1/sdk/products/prd_demo', status: 200, body: { name: 'Demo' } },
      {
        method: 'GET',
        path: '/v1/sdk/products/prd_demo/plans',
        status: 200,
        body: { plans: [{ name: 'Pro' }] },
      },
    ],
    expect: {
      result: narratedToolResult(
        'topup',
        { ...pickerPayload, view: 'topup' } as never,
        'text',
        pickerMeta,
      ),
    },
  })
}

async function responseToJson(res: Response): Promise<unknown> {
  const headers: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: res.status, headers, body }
}

async function recordOauth(): Promise<void> {
  const router = createOAuthFetchRouter({
    publicBaseUrl: 'https://app.example.com',
    apiBaseUrl: 'https://api.example.com',
    productRef: 'prd_demo',
  })

  const get = async (pathName: string, method = 'GET') => {
    const res = await router(new Request(`https://app.example.com${pathName}`, { method }))
    if (!res) {
      return {
        status: 405,
        headers: { 'content-type': 'application/json' },
        body: { error: 'method_not_allowed' },
      }
    }
    return responseToJson(res)
  }

  writeFixture('oauth-proxy/discovery-protected-resource.json', {
    suite: 'oauth-proxy',
    case: 'discovery-protected-resource',
    input: {
      fn: 'mcpOauthRequest',
      args: {
        method: 'GET',
        path: '/.well-known/oauth-protected-resource',
        headers: {},
        body: '',
        config: {
          publicBaseUrl: 'https://app.example.com',
          productRef: 'prd_demo',
          mcpPath: '/mcp',
        },
      },
    },
    expect: { result: await get('/.well-known/oauth-protected-resource') },
  })

  writeFixture('oauth-proxy/discovery-authorization-server.json', {
    suite: 'oauth-proxy',
    case: 'discovery-authorization-server',
    input: {
      fn: 'mcpOauthRequest',
      args: {
        method: 'GET',
        path: '/.well-known/oauth-authorization-server',
        headers: {},
        body: '',
        config: { publicBaseUrl: 'https://app.example.com', productRef: 'prd_demo' },
      },
    },
    expect: { result: await get('/.well-known/oauth-authorization-server') },
  })

  writeFixture('oauth-proxy/discovery-post-405.json', {
    suite: 'oauth-proxy',
    case: 'discovery-post-405',
    input: {
      fn: 'mcpOauthRequest',
      args: {
        method: 'POST',
        path: '/.well-known/oauth-authorization-server',
        headers: {},
        body: '',
        config: { publicBaseUrl: 'https://app.example.com', productRef: 'prd_demo' },
      },
    },
    expect: { result: await get('/.well-known/oauth-authorization-server', 'POST') },
  })

  writeFixture('oauth-proxy/openid-404.json', {
    suite: 'oauth-proxy',
    case: 'openid-404',
    input: {
      fn: 'mcpOauthRequest',
      args: {
        method: 'GET',
        path: '/.well-known/openid-configuration',
        headers: {},
        body: '',
        config: { publicBaseUrl: 'https://app.example.com', productRef: 'prd_demo' },
      },
    },
    expect: { result: await get('/.well-known/openid-configuration') },
  })

  writeFixture('oauth-proxy/authorize.json', {
    suite: 'oauth-proxy',
    case: 'authorize',
    input: {
      fn: 'mcpOauthRequest',
      args: {
        method: 'GET',
        path: '/oauth/authorize?client_id=abc',
        headers: {},
        body: '',
        config: { publicBaseUrl: 'https://app.example.com', productRef: 'prd_demo' },
      },
    },
    expect: { result: await get('/oauth/authorize?client_id=abc') },
  })

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('upstream down')
  }) as typeof fetch
  try {
    const tokenRes = await router(
      new Request('https://app.example.com/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code',
      }),
    )
    writeFixture('oauth-proxy/token-502.json', {
      suite: 'oauth-proxy',
      case: 'token-502',
      input: {
        fn: 'mcpOauthRequest',
        args: {
          method: 'POST',
          path: '/oauth/token',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=authorization_code',
          config: { publicBaseUrl: 'https://app.example.com', productRef: 'prd_demo' },
        },
      },
      expect: {
        result: tokenRes
          ? await responseToJson(tokenRes)
          : { status: 502, body: { error: 'upstream_unreachable' } },
      },
    })
    const registerRes = await router(
      new Request('https://app.example.com/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    writeFixture('oauth-proxy/register-502.json', {
      suite: 'oauth-proxy',
      case: 'register-502',
      input: {
        fn: 'mcpOauthRequest',
        args: {
          method: 'POST',
          path: '/oauth/register',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          config: { publicBaseUrl: 'https://app.example.com', productRef: 'prd_demo' },
        },
      },
      expect: {
        result: registerRes
          ? await responseToJson(registerRes)
          : { status: 502, body: { error: 'upstream_unreachable' } },
      },
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  const customRouter = createOAuthFetchRouter({
    publicBaseUrl: 'https://app.example.com',
    apiBaseUrl: 'https://api.example.com',
    productRef: 'prd_demo',
    oauthPaths: { token: '/custom/token', register: '/custom/register' },
  })
  const asDoc = await customRouter(
    new Request('https://app.example.com/.well-known/oauth-authorization-server'),
  )
  writeFixture('oauth-proxy/paths-override.json', {
    suite: 'oauth-proxy',
    case: 'paths-override',
    input: {
      fn: 'mcpOauthRequest',
      args: {
        method: 'GET',
        path: '/.well-known/oauth-authorization-server',
        headers: {},
        body: '',
        config: {
          publicBaseUrl: 'https://app.example.com',
          productRef: 'prd_demo',
          oauthPaths: { token: '/custom/token', register: '/custom/register' },
        },
      },
    },
    expect: { result: asDoc ? await responseToJson(asDoc) : null },
  })
}

function recordDispatch(): void {
  writeFixture('dispatch/rpc.json', {
    suite: 'dispatch',
    case: 'rpc',
    input: {
      fn: 'mcpDispatch',
      args: {
        rpc: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'fixture', version: '0' },
          },
        },
        config,
      },
    },
    expect: {
      result: {
        kind: 'rpc',
        rpc: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: 'solvapay-mcp', version: '0.1.0' },
          },
        },
      },
    },
  })

  writeFixture('dispatch/challenge.json', {
    suite: 'dispatch',
    case: 'challenge',
    input: {
      fn: 'mcpDispatch',
      args: {
        rpc: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'upgrade', arguments: {} },
        },
        config,
      },
    },
    expect: {
      result: {
        kind: 'challenge',
        status: 401,
        headers: {
          'WWW-Authenticate':
            'Bearer resource_metadata="https://app.example.com/.well-known/oauth-protected-resource"',
          'Access-Control-Expose-Headers': 'WWW-Authenticate',
          'Content-Type': 'application/json',
        },
        body: { jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'Unauthorized' } },
      },
    },
  })

  writeFixture('dispatch/invoke-handler.json', {
    suite: 'dispatch',
    case: 'invoke-handler',
    input: {
      fn: 'mcpDispatch',
      args: {
        rpc: {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'echo_paid', arguments: { n: 1 } },
        },
        config: { ...config, payableTools: ['echo_paid'] },
        authHeader: 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJjdXNfMSJ9.',
      },
    },
    expect: {
      result: {
        kind: 'invokeHandler',
        tool: 'echo_paid',
        args: { n: 1 },
        customerRef: 'cus_1',
      },
    },
  })
}

async function main(): Promise<void> {
  recordNarrate()
  recordBuiltins()
  recordDispatch()
  await recordOauth()
  process.stdout.write('done\n')
}

void main()
