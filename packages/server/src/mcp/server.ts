/**
 * `createSolvaPayMcpServer(options)` — batteries-included factory that
 * registers the full SolvaPay transport + bootstrap tool surface on a fresh
 * `McpServer`, plus the UI resource the `open_*` tools reference.
 *
 * Migrates 700+ lines of mechanical wiring out of every integrator's MCP
 * server entrypoint. See `examples/mcp-checkout-app/src/server.ts` for the
 * canonical usage pattern.
 */

import fs from 'node:fs/promises'
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  CallToolResult,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { SolvaPay } from '../factory'
import type {
  McpToolExtra,
  PaywallStructuredContent,
} from '../types'
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
  getUsageCore,
  isErrorResult,
  listPlansCore,
  processPaymentIntentCore,
  reactivatePurchaseCore,
  syncCustomerCore,
} from '../helpers'
import {
  buildSolvaPayRequest,
  defaultGetCustomerRef as defaultGetCustomerRefHelper,
  enrichPurchase,
  previewJson,
  toolErrorResult,
  toolResult,
} from './helpers'
import { MCP_TOOL_NAMES } from './tool-names'
import {
  registerPayableTool,
  type RegisterPayableToolOptions,
} from './registerPayableTool'

/**
 * Views that `createSolvaPayMcpServer` knows how to bootstrap. Registered
 * via the corresponding `open_*` tool when included in `options.views`.
 */
export type SolvaPayMcpViewKind =
  | 'checkout'
  | 'account'
  | 'topup'
  | 'activate'
  | 'paywall'
  | 'usage'

const DEFAULT_VIEWS: SolvaPayMcpViewKind[] = [
  'checkout',
  'account',
  'topup',
  'activate',
  'paywall',
  'usage',
]

const OPEN_TOOL_FOR_VIEW: Record<SolvaPayMcpViewKind, string> = {
  checkout: MCP_TOOL_NAMES.openCheckout,
  account: MCP_TOOL_NAMES.openAccount,
  topup: MCP_TOOL_NAMES.openTopup,
  activate: MCP_TOOL_NAMES.openPlanActivation,
  paywall: MCP_TOOL_NAMES.openPaywall,
  usage: MCP_TOOL_NAMES.openUsage,
}

export interface SolvaPayMcpCsp {
  /** Domains browsers may load scripts / stylesheets / images from. */
  resourceDomains?: string[]
  /** Domains the UI may open `fetch` / `WebSocket` connections to. */
  connectDomains?: string[]
  /** Domains the UI may embed as iframes. */
  frameDomains?: string[]
}

/**
 * Callback fired from the `additionalTools` hook with helpers bound for
 * the current server + `solvaPay` instance.
 */
export interface AdditionalToolsContext {
  server: McpServer
  solvaPay: SolvaPay
  resourceUri: string
  productRef: string
  /**
   * `registerPayableTool` bound with `solvaPay` + `resourceUri` already
   * provided, and `product` defaulting to the server's `productRef`.
   */
  registerPayable: <InputSchema extends Parameters<typeof registerPayableTool>[2]['schema']>(
    name: string,
    options: Omit<
      RegisterPayableToolOptions<NonNullable<InputSchema>>,
      'solvaPay' | 'resourceUri' | 'product'
    > & {
      product?: string
    },
  ) => void
}

export interface CreateSolvaPayMcpServerOptions {
  /** Initialised SolvaPay instance. */
  solvaPay: SolvaPay
  /** Default product ref for this MCP server (used when tool args omit it). */
  productRef: string
  /** UI resource URI served by this server (e.g. `'ui://my-app/mcp-app.html'`). */
  resourceUri: string
  /** Absolute filesystem path to the built HTML bundle referenced by `resourceUri`. */
  htmlPath: string
  /**
   * Public `https://` origin used as `return_url` for Stripe confirmations.
   * Required because MCP hosts set `window.location.origin` to `"null"`,
   * which Stripe's `confirmPayment` validator rejects.
   */
  publicBaseUrl: string
  /** Which `open_*` tools to register. Defaults to every known view. */
  views?: SolvaPayMcpViewKind[]
  /** Additional CSP allow-lists merged with the Stripe baseline. */
  csp?: SolvaPayMcpCsp
  /**
   * Override customer-ref extraction. Defaults to reading
   * `extra.authInfo.extra.customer_ref` (populated by the MCP OAuth bridge).
   */
  getCustomerRef?: (extra?: McpToolExtra) => string | null
  /**
   * Fired for every tool call so integrators can add tracing / logging.
   * Called before the core helper runs; the result is available on the
   * `response` callback (`onToolResult`).
   */
  onToolCall?: (name: string, args: unknown, extra?: McpToolExtra) => void
  /** Fired after every tool call completes (success or error). */
  onToolResult?: (
    name: string,
    result: CallToolResult,
    meta: { durationMs: number },
  ) => void
  /**
   * Integrator hook to register non-SolvaPay tools. The callback receives
   * the built server plus a `registerPayable` helper bound for this
   * instance.
   */
  additionalTools?: (ctx: AdditionalToolsContext) => void
  /** Overrides the default `McpServer` name. */
  serverName?: string
  /** Overrides the default `McpServer` version. */
  serverVersion?: string
}

const STRIPE_CSP: Required<SolvaPayMcpCsp> = {
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
  ],
  frameDomains: ['https://js.stripe.com', 'https://hooks.stripe.com'],
}

function mergeCsp(overrides: SolvaPayMcpCsp | undefined): Required<SolvaPayMcpCsp> {
  if (!overrides) return STRIPE_CSP
  const merge = (base: string[], extra?: string[]) =>
    extra && extra.length ? Array.from(new Set([...base, ...extra])) : base
  return {
    resourceDomains: merge(STRIPE_CSP.resourceDomains, overrides.resourceDomains),
    connectDomains: merge(STRIPE_CSP.connectDomains, overrides.connectDomains),
    frameDomains: merge(STRIPE_CSP.frameDomains, overrides.frameDomains),
  }
}

/**
 * Build the MCP server and register the full SolvaPay tool surface.
 */
export function createSolvaPayMcpServer(options: CreateSolvaPayMcpServerOptions): McpServer {
  const {
    solvaPay,
    productRef,
    resourceUri,
    htmlPath,
    publicBaseUrl,
    views = DEFAULT_VIEWS,
    csp,
    getCustomerRef = defaultGetCustomerRefHelper,
    onToolCall,
    onToolResult,
    additionalTools,
    serverName = 'solvapay-mcp-server',
    serverVersion = '1.0.0',
  } = options

  if (!/^https?:\/\//i.test(publicBaseUrl)) {
    throw new Error(
      'createSolvaPayMcpServer: publicBaseUrl must be an http(s) URL (Stripe confirmPayment rejects `ui://`).',
    )
  }

  const server = new McpServer({ name: serverName, version: serverVersion })
  const toolMeta = { ui: { resourceUri } }
  const enabledViews = new Set<SolvaPayMcpViewKind>(views)

  const buildRequest = (
    extra: McpToolExtra | undefined,
    init: { method?: string; query?: Record<string, string | undefined>; body?: unknown } = {},
  ) => buildSolvaPayRequest(extra, { ...init, getCustomerRef })

  const requireCustomerRef = (extra: McpToolExtra | undefined): CallToolResult | string => {
    const ref = getCustomerRef(extra)
    if (!ref) {
      return toolErrorResult({
        error: 'Unauthorized',
        status: 401,
        details: 'customer_ref missing from MCP auth context',
      })
    }
    return ref
  }

  const trace = async (
    name: string,
    args: Record<string, unknown>,
    extra: McpToolExtra | undefined,
    handler: () => Promise<CallToolResult>,
  ): Promise<CallToolResult> => {
    const started = Date.now()
    onToolCall?.(name, args, extra)
    try {
      const result = await handler()
      if (onToolResult) onToolResult(name, result, { durationMs: Date.now() - started })
      return result
    } catch (err) {
      const errorResult = toolErrorResult({
        error: err instanceof Error ? err.message : String(err),
        status: 500,
        details: previewJson(err),
      })
      if (onToolResult)
        onToolResult(name, errorResult, { durationMs: Date.now() - started })
      return errorResult
    }
  }

  // ------- bootstrap / open_* tools -------

  interface BootstrapPayload {
    view: SolvaPayMcpViewKind
    productRef: string
    stripePublishableKey: string | null
    returnUrl: string
    /** Only set for the `open_paywall` branch. */
    paywall?: PaywallStructuredContent
  }

  const fetchPublishableKey = async (): Promise<string | null> => {
    try {
      const platform = await solvaPay.apiClient.getPlatformConfig?.()
      return platform?.stripePublishableKey ?? null
    } catch {
      return null
    }
  }

  const buildBootstrapPayload = async (
    view: SolvaPayMcpViewKind,
    extras: { paywall?: PaywallStructuredContent } = {},
  ): Promise<BootstrapPayload> => {
    const stripePublishableKey = await fetchPublishableKey()
    const payload: BootstrapPayload = {
      view,
      productRef,
      stripePublishableKey,
      returnUrl: publicBaseUrl,
    }
    if (extras.paywall) payload.paywall = extras.paywall
    return payload
  }

  const registerOpenTool = (
    view: SolvaPayMcpViewKind,
    title: string,
    description: string,
  ) => {
    if (!enabledViews.has(view)) return
    const name = OPEN_TOOL_FOR_VIEW[view]
    registerAppTool(
      server,
      name,
      { title, description, inputSchema: {}, _meta: toolMeta },
      async (args: Record<string, unknown>, extra?: McpToolExtra) =>
        trace(name, args, extra, async () => toolResult(await buildBootstrapPayload(view))),
    )
  }

  registerOpenTool(
    'checkout',
    'Open checkout',
    'Open the SolvaPay checkout UI inside the host. Use when the customer needs to purchase or upgrade a plan.',
  )
  registerOpenTool(
    'account',
    'Open account',
    'Open the SolvaPay account dashboard inside the host: current plan, balance, payment method, cancel/reactivate controls, and a portal launcher.',
  )
  registerOpenTool(
    'topup',
    'Open top up',
    'Open the SolvaPay top-up flow inside the host so the customer can add usage credits without leaving the conversation.',
  )
  registerOpenTool(
    'activate',
    'Open plan activation',
    'Open the SolvaPay activation flow inside the host for free, trial, or usage-based plans that do not require an upfront payment.',
  )
  registerOpenTool(
    'usage',
    'Open usage',
    'Open the SolvaPay usage dashboard inside the host so the customer can see their current quota, overage, and reset date.',
  )

  // `open_paywall` takes the structured content as input so another tool
  // can hand a paywall payload directly (and so the bootstrap call itself
  // carries everything `<McpApp>` needs to render the view).
  if (enabledViews.has('paywall')) {
    registerAppTool(
      server,
      MCP_TOOL_NAMES.openPaywall,
      {
        title: 'Open paywall',
        description:
          'Open the SolvaPay paywall view so the customer can resolve a payment- or activation-required gate inside the host. Input: `{ content: PaywallStructuredContent }` — pass the structured content returned from a failed paywall-protected tool call.',
        inputSchema: {
          content: z
            .object({
              kind: z.enum(['payment_required', 'activation_required']),
            })
            .passthrough(),
        },
        _meta: toolMeta,
      },
      async (args: Record<string, unknown>, extra?: McpToolExtra) =>
        trace(MCP_TOOL_NAMES.openPaywall, args, extra, async () => {
          const content = args.content as PaywallStructuredContent | undefined
          if (!content || typeof content !== 'object' || !('kind' in content)) {
            return toolErrorResult({
              error: 'Invalid paywall content',
              status: 400,
              details: 'Expected { content: { kind: "payment_required" | "activation_required", ... } }',
            })
          }
          return toolResult(await buildBootstrapPayload('paywall', { paywall: content }))
        }),
    )
  }

  // ------- transport tools -------

  registerAppTool(
    server,
    MCP_TOOL_NAMES.syncCustomer,
    {
      description: 'Ensure the authenticated MCP user exists as a SolvaPay customer.',
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.syncCustomer, args, extra, async () => {
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
        '— do not present them as whole-currency values.',
      ].join(' '),
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.checkPurchase, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await checkPurchaseCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult({
          ...result,
          purchases: result.purchases.map(p => enrichPurchase(p as Record<string, unknown>)),
        })
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.createCheckoutSession,
    {
      description:
        'Create a SolvaPay hosted checkout session and return its URL. The UI opens this URL in a new tab when Stripe Elements is blocked by the host sandbox.',
      inputSchema: {
        planRef: z.string().optional(),
        productRef: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.createCheckoutSession, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const effectiveProduct =
          typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
        const planRef = typeof args.planRef === 'string' && args.planRef ? args.planRef : undefined

        const result = await createCheckoutSessionCore(
          buildRequest(extra, { method: 'POST' }),
          { productRef: effectiveProduct, planRef },
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
        "Return the customer's default card brand / last4 / expiry so the UI can render a \"Visa •••• 4242\" line. Returns { kind: 'none' } when no card is on file.",
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.getPaymentMethod, args, extra, async () => {
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
        'Create a Stripe payment intent for the authenticated customer to purchase a plan. Returns { clientSecret, publishableKey, accountId?, customerRef } for confirmation with Stripe Elements in the app UI.',
      inputSchema: {
        planRef: z.string(),
        productRef: z.string(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.createPayment, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const planRef = typeof args.planRef === 'string' ? args.planRef : ''
        const effectiveProduct =
          typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef

        const result = await createPaymentIntentCore(
          buildRequest(extra, { method: 'POST' }),
          { planRef, productRef: effectiveProduct },
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
      trace(MCP_TOOL_NAMES.processPayment, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const paymentIntentId = typeof args.paymentIntentId === 'string' ? args.paymentIntentId : ''
        const effectiveProduct =
          typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
        const planRef = typeof args.planRef === 'string' && args.planRef ? args.planRef : undefined

        const result = await processPaymentIntentCore(
          buildRequest(extra, { method: 'POST' }),
          { paymentIntentId, productRef: effectiveProduct, planRef },
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
        'List the active plans for a product. Used by the embedded checkout to resolve a plan reference when only productRef is known.',
      inputSchema: { productRef: z.string().optional() },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.listPlans, args, extra, async () => {
        const effectiveProduct =
          typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
        const result = await listPlansCore(
          buildRequest(extra, { query: { productRef: effectiveProduct } }),
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
      description: 'Fetch a single product by reference.',
      inputSchema: { productRef: z.string().optional() },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.getProduct, args, extra, async () => {
        const effectiveProduct =
          typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
        const result = await getProductCore(
          buildRequest(extra, { query: { productRef: effectiveProduct } }),
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
        'Return the merchant identity (name, legal name, support contact) used by mandate text and trust signals.',
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.getMerchant, args, extra, async () => {
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
      trace(MCP_TOOL_NAMES.createCustomerSession, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await createCustomerSessionCore(
          buildRequest(extra, { method: 'POST' }),
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.createTopupPayment,
    {
      description:
        'Create a Stripe payment intent for a credit top-up. Credits are recorded by the SolvaPay webhook after confirmation.',
      inputSchema: {
        amount: z.number().int().positive(),
        currency: z.string(),
        description: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.createTopupPayment, args, extra, async () => {
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
        "Return the authenticated customer's credit balance and display-currency metadata.",
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.getBalance, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await getCustomerBalanceCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.getUsage,
    {
      description:
        "Return the authenticated customer's usage snapshot (used / remaining / percent) for the active usage-based plan.",
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.getUsage, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await getUsageCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.cancelRenewal,
    {
      description:
        'Cancel the auto-renewal on an active purchase. Backend keeps access until the current period ends.',
      inputSchema: {
        purchaseRef: z.string(),
        reason: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.cancelRenewal, args, extra, async () => {
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
        "Undo a pending cancellation so auto-renewal resumes. Only valid while the purchase is still active and its end date hasn't passed.",
      inputSchema: { purchaseRef: z.string() },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.reactivateRenewal, args, extra, async () => {
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
        'Activate a zero-priced, trial, or usage-based plan without collecting payment up-front. For paid plans, use create_payment_intent + process_payment instead.',
      inputSchema: {
        productRef: z.string().optional(),
        planRef: z.string(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      trace(MCP_TOOL_NAMES.activatePlan, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const effectiveProduct =
          typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
        const planRef = typeof args.planRef === 'string' ? args.planRef : ''

        const result = await activatePlanCore(
          buildRequest(extra, { method: 'POST' }),
          { productRef: effectiveProduct, planRef },
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  // ------- integrator-provided additional tools -------

  if (additionalTools) {
    const registerPayable: AdditionalToolsContext['registerPayable'] = (name, opts) => {
      registerPayableTool(server, name, {
        solvaPay,
        resourceUri,
        product: opts.product ?? productRef,
        ...opts,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    }
    additionalTools({ server, solvaPay, resourceUri, productRef, registerPayable })
  }

  // ------- UI resource -------

  const resolvedCsp = mergeCsp(csp)

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          csp: resolvedCsp,
          prefersBorder: true,
        },
      },
    },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(htmlPath, 'utf-8')
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: resolvedCsp,
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
