import fs from 'node:fs/promises'
import path from 'node:path'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  activatePlanCore,
  cancelPurchaseCore,
  checkPurchaseCore,
  createCheckoutSessionCore,
  createCustomerSessionCore,
  createPaymentIntentCore,
  createTopupPaymentIntentCore,
  getCustomerBalanceCore,
  getMerchantCore,
  getPaymentMethodCore,
  getProductCore,
  isErrorResult,
  listPlansCore,
  processPaymentIntentCore,
  reactivatePurchaseCore,
  syncCustomerCore,
  type McpToolExtra,
} from '@solvapay/server'
import { MCP_TOOL_NAMES } from '@solvapay/react/mcp'
import { mcpPublicBaseUrl, solvaPay, solvapayApiOrigin, solvapayProductRef } from './config'

const DIST_DIR = import.meta.filename.endsWith('.ts')
  ? path.join(import.meta.dirname, '../dist')
  : import.meta.dirname

const resourceUri = 'ui://mcp-checkout-app/mcp-app.html'

function getCustomerRef(extra?: McpToolExtra): string | null {
  const fromExtra = extra?.authInfo?.extra?.customer_ref
  if (typeof fromExtra === 'string' && fromExtra.trim()) {
    return fromExtra.trim()
  }
  return null
}

/**
 * Build a synthetic Web Request the core helpers can consume. The `x-user-id`
 * header is what `getAuthenticatedUserCore` uses as the authoritative user
 * identity (see packages/server/src/helpers/auth.ts), so forwarding the
 * `customer_ref` from the MCP OAuth bridge keeps the entire flow headless.
 */
function buildRequest(
  extra: McpToolExtra | undefined,
  options: {
    method?: string
    query?: Record<string, string | undefined>
    body?: unknown
  } = {},
): Request {
  const { method = 'GET', query, body } = options
  const url = new URL('http://mcp-checkout-app.local/')
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value)
    }
  }

  const headers = new Headers()
  const customerRef = getCustomerRef(extra)
  if (customerRef) {
    headers.set('x-user-id', customerRef)
  }
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(body)
  }
  return new Request(url, init)
}

function toolResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  }
}

// ISO 4217 currencies where the "minor unit" equals the major unit. Keep in
// sync with the matching list in @solvapay/react's `formatPrice`.
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
])

function formatMinorUnits(
  amountMinor: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (amountMinor == null || !currency) return null
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase())
  const fractionDigits = zeroDecimal ? 0 : 2
  const major = zeroDecimal ? amountMinor : amountMinor / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(major)
  } catch {
    return null
  }
}

/**
 * Augment a purchase with human-readable price strings so callers (especially
 * LLMs rendering the JSON directly) don't have to reason about minor units.
 * The raw `amount` / `originalAmount` / `currency` fields are preserved for
 * programmatic consumers such as the React transport.
 */
function enrichPurchase(purchase: Record<string, unknown>): Record<string, unknown> {
  const amount = typeof purchase.amount === 'number' ? purchase.amount : undefined
  const originalAmount =
    typeof purchase.originalAmount === 'number' ? purchase.originalAmount : undefined
  const currency = typeof purchase.currency === 'string' ? purchase.currency : undefined

  // `originalAmount` is minor units of `currency` (what the customer was
  // charged). `amount` is always USD cents — used only as a fallback when the
  // currency-aware value isn't populated (free/pending purchases).
  const priceDisplay =
    formatMinorUnits(originalAmount, currency) ?? formatMinorUnits(amount, 'USD')

  // Expose the USD equivalent separately when the customer currency isn't USD
  // so the model can reference both without inventing an FX rate.
  const priceUsdDisplay =
    currency && currency.toUpperCase() !== 'USD'
      ? formatMinorUnits(amount, 'USD')
      : null

  const planSnapshot = purchase.planSnapshot
  const enrichedPlanSnapshot =
    planSnapshot && typeof planSnapshot === 'object'
      ? (() => {
          const snap = planSnapshot as Record<string, unknown>
          const price = typeof snap.price === 'number' ? snap.price : undefined
          const snapCurrency = typeof snap.currency === 'string' ? snap.currency : undefined
          const snapPriceDisplay = formatMinorUnits(price, snapCurrency)
          return snapPriceDisplay ? { ...snap, priceDisplay: snapPriceDisplay } : snap
        })()
      : planSnapshot

  return {
    ...purchase,
    ...(priceDisplay ? { priceDisplay } : {}),
    ...(priceUsdDisplay ? { priceUsdDisplay } : {}),
    ...(enrichedPlanSnapshot !== undefined ? { planSnapshot: enrichedPlanSnapshot } : {}),
  }
}

function toolErrorResult(error: { error: string; status: number; details?: string }): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(error) }],
    structuredContent: error as unknown as Record<string, unknown>,
  }
}

function previewJson(value: unknown, max = 400): string {
  try {
    const json = JSON.stringify(value)
    if (!json) return String(value)
    return json.length > max ? `${json.slice(0, max)}…(+${json.length - max} chars)` : json
  } catch {
    return String(value)
  }
}

async function traceTool<TArgs extends Record<string, unknown>>(
  name: string,
  args: TArgs,
  extra: McpToolExtra | undefined,
  handler: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const started = Date.now()
  const customerRef = getCustomerRef(extra)
  console.error(`[mcp-checkout-app] -> ${name}`, {
    customerRef: customerRef ?? null,
    args: previewJson(args),
  })
  try {
    const result = await handler()
    const ms = Date.now() - started
    if (result.isError) {
      console.error(`[mcp-checkout-app] <- ${name} ERROR in ${ms}ms`, {
        body: previewJson(result.structuredContent ?? result.content),
      })
    } else {
      console.error(`[mcp-checkout-app] <- ${name} ok in ${ms}ms`, {
        body: previewJson(result.structuredContent ?? result.content),
      })
    }
    return result
  } catch (err) {
    const ms = Date.now() - started
    console.error(`[mcp-checkout-app] <- ${name} THREW in ${ms}ms`, err)
    throw err
  }
}

function requireCustomerRef(extra?: McpToolExtra): CallToolResult | string {
  const customerRef = getCustomerRef(extra)
  if (!customerRef) {
    return toolErrorResult({
      error: 'Unauthorized',
      status: 401,
      details: 'customer_ref missing from MCP auth context',
    })
  }
  return customerRef
}

/**
 * View discriminators returned by every `open_*` bootstrap tool. The client
 * router in `mcp-app.tsx` reads this to decide which screen to mount.
 */
type BootstrapView = 'checkout' | 'account' | 'topup' | 'activate'

async function fetchPlatformPublishableKey(): Promise<string | null> {
  // Fetch SolvaPay's platform Stripe pk (resolved sandbox/live against the
  // authenticated provider on the backend) so the client can prime
  // `useStripeProbe`. Safe to forward — publishable keys are browser-visible
  // by design, and `create_payment_intent` returns the same value for the
  // actual confirm call. On any failure (backend down, missing config, older
  // backend without the endpoint) we fall back to `null` so the UI probe
  // reports `'blocked'` and the hosted-button card renders.
  try {
    const platform = await solvaPay.apiClient.getPlatformConfig?.()
    return platform?.stripePublishableKey ?? null
  } catch (err) {
    console.warn('[mcp-checkout-app] getPlatformConfig failed', err)
    return null
  }
}

async function buildBootstrapPayload(view: BootstrapView): Promise<{
  view: BootstrapView
  productRef: string
  stripePublishableKey: string | null
  returnUrl: string
}> {
  const stripePublishableKey = await fetchPlatformPublishableKey()
  return {
    view,
    productRef: solvapayProductRef,
    stripePublishableKey,
    // Stripe's confirmPayment validator rejects the `ui://` iframe location
    // as a `return_url`. Surface the MCP app's public https origin so the
    // client can thread it into `PaymentForm.Root` / `TopupForm.Root`.
    returnUrl: mcpPublicBaseUrl,
  }
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'solvapay-mcp-checkout-app',
    version: '1.0.0',
  })

  const toolMeta = { ui: { resourceUri } }

  const registerOpenTool = (
    name: string,
    title: string,
    description: string,
    view: BootstrapView,
  ) => {
    registerAppTool(
      server,
      name,
      { title, description, inputSchema: {}, _meta: toolMeta },
      async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
        traceTool(name, args, extra, async () => toolResult(await buildBootstrapPayload(view))),
    )
  }

  registerOpenTool(
    'open_checkout',
    'Open checkout',
    'Open the SolvaPay checkout UI inside the host. Use when the customer needs to purchase or upgrade a plan.',
    'checkout',
  )

  registerOpenTool(
    'open_account',
    'Open account',
    'Open the SolvaPay account dashboard inside the host: current plan, balance, payment method, cancel/reactivate controls, and a portal launcher.',
    'account',
  )

  registerOpenTool(
    'open_topup',
    'Open top up',
    'Open the SolvaPay top-up flow inside the host so the customer can add usage credits without leaving the conversation.',
    'topup',
  )

  registerOpenTool(
    'open_plan_activation',
    'Open plan activation',
    'Open the SolvaPay activation flow inside the host for free, trial, or usage-based plans that do not require an upfront payment.',
    'activate',
  )

  registerAppTool(
    server,
    'sync_customer',
    {
      description: 'Ensure the authenticated MCP user exists as a SolvaPay customer.',
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool('sync_customer', args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await syncCustomerCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult({ customerRef: result })
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.checkPurchase,
    {
      description: [
        'Fetch the active purchase for the authenticated customer.',
        'For any human-readable price, prefer `priceDisplay` (customer-facing,',
        'e.g. "SEK 500.00") or `planSnapshot.priceDisplay`. Raw `amount` is',
        'always USD cents and `originalAmount` is minor units of `currency`',
        '(e.g. öre for SEK) — do not present them as whole-currency values.',
      ].join(' '),
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.checkPurchase, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await checkPurchaseCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        const enriched = {
          ...result,
          purchases: result.purchases.map(p =>
            enrichPurchase(p as Record<string, unknown>),
          ),
        }
        return toolResult(enriched)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.createCheckoutSession,
    {
      description:
        'Create a SolvaPay hosted checkout session and return its URL. The UI opens this URL in a new tab because Stripe.js is blocked inside the MCP host sandbox. returnUrl is intentionally unset — there is no meaningful URL for the MCP iframe to return to, so the SolvaPay backend default is used.',
      inputSchema: {
        planRef: z.string().optional(),
        productRef: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.createCheckoutSession, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const productRef = typeof args.productRef === 'string' && args.productRef
          ? args.productRef
          : solvapayProductRef
        const planRef = typeof args.planRef === 'string' && args.planRef ? args.planRef : undefined

        const result = await createCheckoutSessionCore(
          buildRequest(extra, { method: 'POST' }),
          { productRef, planRef },
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.getPaymentMethod,
    {
      description:
        "Return the customer's default card brand / last4 / expiry so the UI can render a \"Visa •••• 4242\" line on the current-plan card. Returns { kind: 'none' } when no card is on file.",
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.getPaymentMethod, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await getPaymentMethodCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.createPayment,
    {
      description:
        'Create a Stripe payment intent for the authenticated customer to purchase a plan. Returns { clientSecret, publishableKey, accountId?, customerRef } for confirmation with Stripe Elements in the app UI. Requires the MCP host to permit Stripe domains via declared CSP — the app falls back to create_checkout_session when the embedded path is blocked.',
      inputSchema: {
        planRef: z.string(),
        productRef: z.string(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.createPayment, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const planRef = typeof args.planRef === 'string' ? args.planRef : ''
        const productRef =
          typeof args.productRef === 'string' && args.productRef
            ? args.productRef
            : solvapayProductRef

        const result = await createPaymentIntentCore(
          buildRequest(extra, { method: 'POST' }),
          { planRef, productRef },
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.processPayment,
    {
      description:
        'Process a Stripe payment intent after client-side confirmation and create the SolvaPay purchase. Call after confirmPayment resolves to short-circuit webhook latency.',
      inputSchema: {
        paymentIntentId: z.string(),
        productRef: z.string(),
        planRef: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.processPayment, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const paymentIntentId = typeof args.paymentIntentId === 'string' ? args.paymentIntentId : ''
        const productRef =
          typeof args.productRef === 'string' && args.productRef
            ? args.productRef
            : solvapayProductRef
        const planRef = typeof args.planRef === 'string' && args.planRef ? args.planRef : undefined

        const result = await processPaymentIntentCore(
          buildRequest(extra, { method: 'POST' }),
          { paymentIntentId, productRef, planRef },
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.listPlans,
    {
      description:
        "List the active plans for a product. Used by the embedded checkout to resolve a plan reference when only productRef is known, and by <PricingSelector> to render the plan list.",
      inputSchema: {
        productRef: z.string(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.listPlans, args, extra, async () => {
        const productRef =
          typeof args.productRef === 'string' && args.productRef
            ? args.productRef
            : solvapayProductRef

        const result = await listPlansCore(
          buildRequest(extra, { query: { productRef } }),
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.getProduct,
    {
      description:
        'Fetch a single product by reference. Used by the embedded checkout summary and by <CheckoutSummary>.',
      inputSchema: {
        productRef: z.string(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.getProduct, args, extra, async () => {
        const productRef =
          typeof args.productRef === 'string' && args.productRef
            ? args.productRef
            : solvapayProductRef

        const result = await getProductCore(
          buildRequest(extra, { query: { productRef } }),
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.getMerchant,
    {
      description:
        "Return the merchant identity (name, legal name, support contact) used by <MandateText> and trust signals in the embedded checkout.",
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.getMerchant, args, extra, async () => {
        const result = await getMerchantCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.createCustomerSession,
    {
      description:
        'Create a SolvaPay hosted customer portal session and return its URL. Used to let a paid customer manage or cancel their purchase in a new tab.',
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.createCustomerSession, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const result = await createCustomerSessionCore(buildRequest(extra, { method: 'POST' }), {
          solvaPay,
        })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.createTopupPayment,
    {
      description:
        'Create a Stripe payment intent for a credit top-up. Returns { clientSecret, publishableKey, accountId?, customerRef } for confirmation with Stripe Elements in the app UI. Credits are recorded by the SolvaPay webhook after confirmation — no follow-up process_payment call is needed.',
      inputSchema: {
        amount: z.number().int().positive(),
        currency: z.string(),
        description: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.createTopupPayment, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const amount = typeof args.amount === 'number' ? args.amount : 0
        const currency = typeof args.currency === 'string' ? args.currency : ''
        const description = typeof args.description === 'string' ? args.description : undefined

        const result = await createTopupPaymentIntentCore(
          buildRequest(extra, { method: 'POST' }),
          { amount, currency, description },
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.getBalance,
    {
      description:
        "Return the authenticated customer's credit balance and display-currency metadata. Used by `useBalance` / `<BalanceBadge>` / `<CreditGate>`.",
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.getBalance, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const result = await getCustomerBalanceCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.cancelRenewal,
    {
      description:
        "Cancel the auto-renewal on an active purchase. Backend keeps access until the current period ends; `check_purchase` will start reporting the purchase as cancelled-with-access-until. Used by `<CancelPlanButton>`.",
      inputSchema: {
        purchaseRef: z.string(),
        reason: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.cancelRenewal, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const purchaseRef = typeof args.purchaseRef === 'string' ? args.purchaseRef : ''
        const reason = typeof args.reason === 'string' ? args.reason : undefined

        const result = await cancelPurchaseCore(
          buildRequest(extra, { method: 'POST' }),
          { purchaseRef, reason },
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.reactivateRenewal,
    {
      description:
        "Undo a pending cancellation so auto-renewal resumes. Only valid while the purchase is still active and its end date hasn't passed. Used by `<CancelledPlanNotice>`'s reactivate CTA.",
      inputSchema: {
        purchaseRef: z.string(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.reactivateRenewal, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const purchaseRef = typeof args.purchaseRef === 'string' ? args.purchaseRef : ''

        const result = await reactivatePurchaseCore(
          buildRequest(extra, { method: 'POST' }),
          { purchaseRef },
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.activatePlan,
    {
      description:
        'Activate a zero-priced, trial, or usage-based plan without collecting payment up-front. Returns the resulting purchase. Used by `useActivation` / `<ActivationFlow>`. For paid plans, use `create_payment_intent` + `process_payment` instead.',
      inputSchema: {
        productRef: z.string(),
        planRef: z.string(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.activatePlan, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const productRef =
          typeof args.productRef === 'string' && args.productRef
            ? args.productRef
            : solvapayProductRef
        const planRef = typeof args.planRef === 'string' ? args.planRef : ''

        const result = await activatePlanCore(
          buildRequest(extra, { method: 'POST' }),
          { productRef, planRef },
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  // CSP the app needs so Stripe Elements can load inside the host sandbox.
  // Hosts that implement the MCP Apps spec honor these lists when building
  // the iframe's Content-Security-Policy. Declare them on both the
  // resource metadata (listing-level default) and the content item
  // (what hosts actually read at render time) so compliant hosts like
  // basic-host / ChatGPT see a complete policy.
  //
  // Keep resourceDomains / connectDomains / frameDomains aligned with
  // Stripe's recommended allowlist — trimming any of them risks blocking
  // the nested card-input iframes Stripe serves from js.stripe.com.
  const appCsp = {
    resourceDomains: [
      'https://js.stripe.com',
      'https://*.stripe.com',
      'https://b.stripecdn.com',
    ],
    connectDomains: [
      'https://api.stripe.com',
      'https://m.stripe.com',
      'https://r.stripe.com',
      'https://q.stripe.com',
      'https://errors.stripe.com',
      solvapayApiOrigin,
    ],
    frameDomains: [
      'https://js.stripe.com',
      'https://hooks.stripe.com',
    ],
  }

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          csp: appCsp,
          prefersBorder: true,
        },
      },
    },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, 'mcp-app.html'), 'utf-8')
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: appCsp,
                prefersBorder: true,
              },
            },
          },
        ],
      }
    },
  )

  return server
}
