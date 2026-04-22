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
  createCheckoutSessionCore,
  createCustomerSessionCore,
  createPaymentIntentCore,
  createTopupPaymentIntentCore,
  isErrorResult,
  processPaymentIntentCore,
  reactivatePurchaseCore,
  type SolvaPay,
} from '@solvapay/server'
import { z } from 'zod'
import {
  buildSolvaPayRequest,
  defaultGetCustomerRef as defaultGetCustomerRefHelper,
  previewJson,
  toolErrorResult,
  toolResult,
} from './helpers'
import {
  createBuildBootstrapPayload,
  type BuildBootstrapPayloadFn,
} from './bootstrap-payload'
import { mergeCsp } from './csp'
import { MCP_TOOL_NAMES } from './tool-names'
import { SOLVAPAY_MCP_VIEW_KINDS, TOOL_FOR_VIEW } from './types'
import type {
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
  /**
   * Parallelised fetch of merchant + product + plans + (optional)
   * customer snapshot that backs every `open_*` tool. Exposed so the
   * paywall envelope (`paywallToolResult`, `buildPayableHandler`) can
   * embed the full payload in its `structuredContent`.
   */
  buildBootstrapPayload: BuildBootstrapPayloadFn
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
  // State-change tools that need a server round-trip from inside the
  // embedded UI but offer no LLM-facing use. Hosts that honour
  // `_meta.audience` can hide these from the model; hosts that don't,
  // still see them but are steered away by the description prefix.
  const uiToolMeta = { ...toolMeta, audience: 'ui' as const }
  const enabledViews = new Set<SolvaPayMcpViewKind>(views)
  const tools: SolvaPayToolDescriptor[] = []

  const UI_ONLY_PREFIX =
    'UI-only; agents should prefer `upgrade` / `manage_account` / `activate_plan`. '

  const buildRequest = (
    extra: McpToolExtra | undefined,
    init: { method?: string; query?: Record<string, string | undefined>; body?: unknown } = {},
  ) => buildSolvaPayRequest(extra, { ...init, getCustomerRef })

  const requireCustomerRef = (extra: McpToolExtra | undefined): SolvaPayCallToolResult | string => {
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

  const buildBootstrapPayload: BuildBootstrapPayloadFn = createBuildBootstrapPayload({
    solvaPay,
    productRef,
    publicBaseUrl,
    getCustomerRef,
  })

  const pushIntentTool = (
    view: keyof typeof TOOL_FOR_VIEW,
    title: string,
    description: string,
  ) => {
    if (!enabledViews.has(view)) return
    const name = TOOL_FOR_VIEW[view]
    tools.push({
      name,
      title,
      description,
      inputSchema: {},
      meta: toolMeta,
      handler: async (args, extra) =>
        trace(name, args, extra, async () => toolResult(await buildBootstrapPayload(view, extra))),
    })
  }

  pushIntentTool(
    'checkout',
    'Upgrade plan',
    'Start or change a paid plan for the current customer. On UI hosts this opens the embedded checkout view; on text-only hosts the response carries a markdown summary with a checkout URL the user can click.',
  )
  pushIntentTool(
    'account',
    'Manage account',
    'Show or manage the current customer\'s SolvaPay account: plan, balance, payment method, cancel/reactivate controls. UI hosts open the embedded account view; text-only hosts get a markdown summary.',
  )
  pushIntentTool(
    'topup',
    'Top up credits',
    'Add SolvaPay credits for the current customer. UI hosts open the embedded top-up flow; text-only hosts get a markdown summary with a top-up URL.',
  )
  // `activate_plan` is registered below (transport section) as a
  // dual-audience tool that handles both the picker bootstrap (no
  // planRef) and smart activation (planRef provided), replacing the
  // legacy `open_plan_activation` intent.
  pushIntentTool(
    'usage',
    'Check usage',
    'Show the current customer\'s usage snapshot (used, remaining, reset date) for the active usage-based plan. UI hosts open the embedded usage view; text-only hosts get a markdown summary.',
  )

  // Paywall responses now carry the full BootstrapPayload in their
  // `structuredContent` (see `@solvapay/mcp/paywallToolResult`), so
  // there is no dedicated `open_paywall` tool for the host to re-invoke.

  // ------- transport tools -------

  tools.push({
    name: MCP_TOOL_NAMES.createCheckoutSession,
    description:
      UI_ONLY_PREFIX +
      'Create a SolvaPay hosted checkout session and return its URL. The UI opens this URL in a new tab when Stripe Elements is blocked by the host sandbox.',
    inputSchema: {
      planRef: z.string().optional(),
      productRef: z.string().optional(),
    },
    meta: uiToolMeta,
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
    name: MCP_TOOL_NAMES.createPayment,
    description:
      UI_ONLY_PREFIX +
      'Create a Stripe payment intent for the authenticated customer to purchase a plan. Returns { clientSecret, publishableKey, accountId?, customerRef } for confirmation with Stripe Elements in the app UI.',
    inputSchema: {
      planRef: z.string(),
      productRef: z.string(),
    },
    meta: uiToolMeta,
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
      UI_ONLY_PREFIX +
      'Process a Stripe payment intent after client-side confirmation and create the SolvaPay purchase. Call after confirmPayment resolves to short-circuit webhook latency.',
    inputSchema: {
      paymentIntentId: z.string(),
      productRef: z.string(),
      planRef: z.string().optional(),
    },
    meta: uiToolMeta,
    handler: async (args, extra) =>
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
  })

  tools.push({
    name: MCP_TOOL_NAMES.createCustomerSession,
    description:
      UI_ONLY_PREFIX +
      'Create a SolvaPay hosted customer portal session and return its URL. Used to let a paid customer manage or cancel their purchase in a new tab.',
    inputSchema: {},
    meta: uiToolMeta,
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.createCustomerSession, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await createCustomerSessionCore(buildRequest(extra, { method: 'POST' }), {
          solvaPay,
        })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  })

  tools.push({
    name: MCP_TOOL_NAMES.createTopupPayment,
    description:
      UI_ONLY_PREFIX +
      'Create a Stripe payment intent for a credit top-up. Credits are recorded by the SolvaPay webhook after confirmation.',
    inputSchema: {
      amount: z.number().int().positive(),
      currency: z.string(),
      description: z.string().optional(),
    },
    meta: uiToolMeta,
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
    name: MCP_TOOL_NAMES.cancelRenewal,
    description:
      UI_ONLY_PREFIX +
      'Cancel the auto-renewal on an active purchase. Backend keeps access until the current period ends.',
    inputSchema: {
      purchaseRef: z.string(),
      reason: z.string().optional(),
    },
    meta: uiToolMeta,
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
      UI_ONLY_PREFIX +
      "Undo a pending cancellation so auto-renewal resumes. Only valid while the purchase is still active and its end date hasn't passed.",
    inputSchema: { purchaseRef: z.string() },
    meta: uiToolMeta,
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
    title: 'Activate plan',
    description:
      'Activate a plan for the current customer. With a `planRef`: free plans activate immediately; usage-based plans activate when the balance covers the configured usage; paid plans return a markdown checkout link (text-only hosts) or open the embedded checkout (UI hosts). Without a `planRef`: returns the available plans so the customer can pick one — UI hosts render the embedded picker, text-only hosts see the plans list in the markdown summary.',
    inputSchema: {
      productRef: z.string().optional(),
      planRef: z.string().optional(),
    },
    meta: toolMeta,
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.activatePlan, args, extra, async () => {
        const effectiveProduct =
          typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
        const planRef = typeof args.planRef === 'string' && args.planRef ? args.planRef : undefined

        // No plan picked yet — return the picker bootstrap (the React
        // shell opens `<McpActivateView>`; text-only hosts narrate the
        // markdown summary listing the available plans). Respect the
        // `views` filter so consumers that restrict the surface (e.g.
        // `views: ['checkout']`) don't accidentally expose the
        // activation picker as an alternate entry point.
        if (!planRef) {
          if (!enabledViews.has('activate')) {
            return toolErrorResult({
              error: 'activate_plan requires a planRef on this server',
              status: 400,
              details:
                'The activation-picker view is not enabled on this server. Pass `planRef` to activate a specific plan, or re-enable the "activate" view via the `views` option.',
            })
          }
          return toolResult(await buildBootstrapPayload('activate', extra))
        }

        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

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

  return { tools, resource, buildBootstrapPayload }
}
