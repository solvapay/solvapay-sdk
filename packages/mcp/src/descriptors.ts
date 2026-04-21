/**
 * `buildSolvaPayDescriptors(options)` — framework-neutral tool surface
 * builder that every SolvaPay MCP adapter (`@solvapay/mcp-sdk`, future
 * `@solvapay/mcp-lite`, `@solvapay/mcp-fastmcp`) maps onto its own
 * registration API.
 *
 * Body is lifted from the original
 * `packages/server/src/mcp/server.ts#createSolvaPayMcpServer`. The only
 * mechanical difference: instead of calling `registerAppTool(server, ...)`,
 * we push `{ name, handler, ... }` onto a `tools[]` array the adapter
 * iterates.
 */

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
  type PaywallStructuredContent,
  type SolvaPay,
} from '@solvapay/server'
import { z } from 'zod'
import {
  buildSolvaPayRequest,
  defaultGetCustomerRef as defaultGetCustomerRefHelper,
  enrichPurchase,
  previewJson,
  toolErrorResult,
  toolResult,
} from './helpers'
import { mergeCsp } from './csp'
import { MCP_TOOL_NAMES } from './tool-names'
import { OPEN_TOOL_FOR_VIEW, SOLVAPAY_MCP_VIEW_KINDS } from './types'
import type {
  BootstrapPayload,
  McpToolExtra,
  SolvaPayCallToolResult,
  SolvaPayMcpCsp,
  SolvaPayMcpViewKind,
  SolvaPayResourceDescriptor,
  SolvaPayToolDescriptor,
} from './types'

const DEFAULT_VIEWS: SolvaPayMcpViewKind[] = [...SOLVAPAY_MCP_VIEW_KINDS]

export interface BuildSolvaPayDescriptorsOptions {
  /** Initialised SolvaPay instance. */
  solvaPay: SolvaPay
  /** Default product ref for this MCP server (used when tool args omit it). */
  productRef: string
  /** UI resource URI served by this server (e.g. `'ui://my-app/mcp-app.html'`). */
  resourceUri: string
  /**
   * Absolute filesystem path to the built HTML bundle referenced by
   * `resourceUri`. Node-only convenience — dynamic-imports
   * `node:fs/promises` internally. Provide `readHtml` instead for edge
   * runtimes.
   */
  htmlPath?: string
  /**
   * Edge-neutral alternative to `htmlPath`. One of `htmlPath` or
   * `readHtml` must be provided.
   */
  readHtml?: () => Promise<string>
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
   * `extra.authInfo.extra.customer_ref` (populated by the MCP OAuth
   * bridge).
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
    result: SolvaPayCallToolResult,
    meta: { durationMs: number },
  ) => void
}

export interface SolvaPayDescriptorBundle {
  tools: SolvaPayToolDescriptor[]
  resource: SolvaPayResourceDescriptor
}

/**
 * Build the framework-neutral SolvaPay tool + resource descriptors. The
 * returned bundle is adapter-shaped — pass it to the registration helper
 * exported by `@solvapay/mcp-sdk` (or any future adapter package).
 */
export function buildSolvaPayDescriptors(
  options: BuildSolvaPayDescriptorsOptions,
): SolvaPayDescriptorBundle {
  const {
    solvaPay,
    productRef,
    resourceUri,
    htmlPath,
    readHtml,
    publicBaseUrl,
    views = DEFAULT_VIEWS,
    csp,
    getCustomerRef = defaultGetCustomerRefHelper,
    onToolCall,
    onToolResult,
  } = options

  if (!/^https?:\/\//i.test(publicBaseUrl)) {
    throw new Error(
      'buildSolvaPayDescriptors: publicBaseUrl must be an http(s) URL (Stripe confirmPayment rejects `ui://`).',
    )
  }

  if (!htmlPath && !readHtml) {
    throw new Error(
      'buildSolvaPayDescriptors: either `htmlPath` (node) or `readHtml` (edge) must be provided.',
    )
  }

  const toolMeta = { ui: { resourceUri } }
  const enabledViews = new Set<SolvaPayMcpViewKind>(views)
  const tools: SolvaPayToolDescriptor[] = []

  const buildRequest = (
    extra: McpToolExtra | undefined,
    init: { method?: string; query?: Record<string, string | undefined>; body?: unknown } = {},
  ) => buildSolvaPayRequest(extra, { ...init, getCustomerRef })

  const requireCustomerRef = (
    extra: McpToolExtra | undefined,
  ): SolvaPayCallToolResult | string => {
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
    handler: () => Promise<SolvaPayCallToolResult>,
  ): Promise<SolvaPayCallToolResult> => {
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
      if (onToolResult) onToolResult(name, errorResult, { durationMs: Date.now() - started })
      return errorResult
    }
  }

  // ------- bootstrap / open_* tools -------

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

  const pushOpenTool = (view: SolvaPayMcpViewKind, title: string, description: string) => {
    if (!enabledViews.has(view)) return
    const name = OPEN_TOOL_FOR_VIEW[view]
    tools.push({
      name,
      title,
      description,
      inputSchema: {},
      meta: toolMeta,
      handler: async (args, extra) =>
        trace(name, args, extra, async () => toolResult(await buildBootstrapPayload(view))),
    })
  }

  pushOpenTool(
    'checkout',
    'Open checkout',
    'Open the SolvaPay checkout UI inside the host. Use when the customer needs to purchase or upgrade a plan.',
  )
  pushOpenTool(
    'account',
    'Open account',
    'Open the SolvaPay account dashboard inside the host: current plan, balance, payment method, cancel/reactivate controls, and a portal launcher.',
  )
  pushOpenTool(
    'topup',
    'Open top up',
    'Open the SolvaPay top-up flow inside the host so the customer can add usage credits without leaving the conversation.',
  )
  pushOpenTool(
    'activate',
    'Open plan activation',
    'Open the SolvaPay activation flow inside the host for free, trial, or usage-based plans that do not require an upfront payment.',
  )
  pushOpenTool(
    'usage',
    'Open usage',
    'Open the SolvaPay usage dashboard inside the host so the customer can see their current quota, overage, and reset date.',
  )

  if (enabledViews.has('paywall')) {
    tools.push({
      name: MCP_TOOL_NAMES.openPaywall,
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
      meta: toolMeta,
      handler: async (args, extra) =>
        trace(MCP_TOOL_NAMES.openPaywall, args, extra, async () => {
          const content = args.content as PaywallStructuredContent | undefined
          if (!content || typeof content !== 'object' || !('kind' in content)) {
            return toolErrorResult({
              error: 'Invalid paywall content',
              status: 400,
              details:
                'Expected { content: { kind: "payment_required" | "activation_required", ... } }',
            })
          }
          return toolResult(await buildBootstrapPayload('paywall', { paywall: content }))
        }),
    })
  }

  // ------- transport tools -------

  tools.push({
    name: MCP_TOOL_NAMES.syncCustomer,
    description: 'Ensure the authenticated MCP user exists as a SolvaPay customer.',
    inputSchema: {},
    meta: toolMeta,
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.syncCustomer, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await syncCustomerCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult({ customerRef: result })
      }),
  })

  tools.push({
    name: MCP_TOOL_NAMES.checkPurchase,
    description: [
      'Fetch the active purchase for the authenticated customer.',
      'For any human-readable price, prefer `priceDisplay` (customer-facing,',
      'e.g. "SEK 500.00") or `planSnapshot.priceDisplay`. Raw `amount` is',
      'always USD cents and `originalAmount` is minor units of `currency`',
      '— do not present them as whole-currency values.',
    ].join(' '),
    inputSchema: {},
    meta: toolMeta,
    handler: async (args, extra) =>
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
  })

  tools.push({
    name: MCP_TOOL_NAMES.createCheckoutSession,
    description:
      'Create a SolvaPay hosted checkout session and return its URL. The UI opens this URL in a new tab when Stripe Elements is blocked by the host sandbox.',
    inputSchema: {
      planRef: z.string().optional(),
      productRef: z.string().optional(),
    },
    meta: toolMeta,
    handler: async (args, extra) =>
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
  })

  tools.push({
    name: MCP_TOOL_NAMES.getPaymentMethod,
    description:
      "Return the customer's default card brand / last4 / expiry so the UI can render a \"Visa •••• 4242\" line. Returns { kind: 'none' } when no card is on file.",
    inputSchema: {},
    meta: toolMeta,
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.getPaymentMethod, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await getPaymentMethodCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  })

  tools.push({
    name: MCP_TOOL_NAMES.createPayment,
    description:
      'Create a Stripe payment intent for the authenticated customer to purchase a plan. Returns { clientSecret, publishableKey, accountId?, customerRef } for confirmation with Stripe Elements in the app UI.',
    inputSchema: {
      planRef: z.string(),
      productRef: z.string(),
    },
    meta: toolMeta,
    handler: async (args, extra) =>
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
  })

  tools.push({
    name: MCP_TOOL_NAMES.processPayment,
    description:
      'Process a Stripe payment intent after client-side confirmation and create the SolvaPay purchase. Call after confirmPayment resolves to short-circuit webhook latency.',
    inputSchema: {
      paymentIntentId: z.string(),
      productRef: z.string(),
      planRef: z.string().optional(),
    },
    meta: toolMeta,
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.processPayment, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const paymentIntentId =
          typeof args.paymentIntentId === 'string' ? args.paymentIntentId : ''
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
  })

  tools.push({
    name: MCP_TOOL_NAMES.listPlans,
    description:
      'List the active plans for a product. Used by the embedded checkout to resolve a plan reference when only productRef is known.',
    inputSchema: { productRef: z.string().optional() },
    meta: toolMeta,
    handler: async (args, extra) =>
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
  })

  tools.push({
    name: MCP_TOOL_NAMES.getProduct,
    description: 'Fetch a single product by reference.',
    inputSchema: { productRef: z.string().optional() },
    meta: toolMeta,
    handler: async (args, extra) =>
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
  })

  tools.push({
    name: MCP_TOOL_NAMES.getMerchant,
    description:
      'Return the merchant identity (name, legal name, support contact) used by mandate text and trust signals.',
    inputSchema: {},
    meta: toolMeta,
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.getMerchant, args, extra, async () => {
        const result = await getMerchantCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  })

  tools.push({
    name: MCP_TOOL_NAMES.createCustomerSession,
    description:
      'Create a SolvaPay hosted customer portal session and return its URL. Used to let a paid customer manage or cancel their purchase in a new tab.',
    inputSchema: {},
    meta: toolMeta,
    handler: async (args, extra) =>
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
  })

  tools.push({
    name: MCP_TOOL_NAMES.createTopupPayment,
    description:
      'Create a Stripe payment intent for a credit top-up. Credits are recorded by the SolvaPay webhook after confirmation.',
    inputSchema: {
      amount: z.number().int().positive(),
      currency: z.string(),
      description: z.string().optional(),
    },
    meta: toolMeta,
    handler: async (args, extra) =>
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
  })

  tools.push({
    name: MCP_TOOL_NAMES.getBalance,
    description:
      "Return the authenticated customer's credit balance and display-currency metadata.",
    inputSchema: {},
    meta: toolMeta,
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.getBalance, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await getCustomerBalanceCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  })

  tools.push({
    name: MCP_TOOL_NAMES.getUsage,
    description:
      "Return the authenticated customer's usage snapshot (used / remaining / percent) for the active usage-based plan.",
    inputSchema: {},
    meta: toolMeta,
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.getUsage, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await getUsageCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  })

  tools.push({
    name: MCP_TOOL_NAMES.cancelRenewal,
    description:
      'Cancel the auto-renewal on an active purchase. Backend keeps access until the current period ends.',
    inputSchema: {
      purchaseRef: z.string(),
      reason: z.string().optional(),
    },
    meta: toolMeta,
    handler: async (args, extra) =>
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
  })

  tools.push({
    name: MCP_TOOL_NAMES.reactivateRenewal,
    description:
      "Undo a pending cancellation so auto-renewal resumes. Only valid while the purchase is still active and its end date hasn't passed.",
    inputSchema: { purchaseRef: z.string() },
    meta: toolMeta,
    handler: async (args, extra) =>
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
  })

  tools.push({
    name: MCP_TOOL_NAMES.activatePlan,
    description:
      'Activate a zero-priced, trial, or usage-based plan without collecting payment up-front. For paid plans, use create_payment_intent + process_payment instead.',
    inputSchema: {
      productRef: z.string().optional(),
      planRef: z.string(),
    },
    meta: toolMeta,
    handler: async (args, extra) =>
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
  })

  // ------- UI resource -------

  const resolvedCsp = mergeCsp(csp)
  const resource: SolvaPayResourceDescriptor = {
    uri: resourceUri,
    mimeType: 'text/html;profile=mcp-app',
    csp: resolvedCsp,
    readHtml: readHtml
      ? readHtml
      : async () => {
          const fs = await import('node:fs/promises')
          // htmlPath is validated above; non-null here.
          return fs.readFile(htmlPath as string, 'utf-8')
        },
  }

  return { tools, resource }
}
