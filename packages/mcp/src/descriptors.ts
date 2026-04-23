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
  narratedToolResult,
  parseMode,
  previewJson,
  toolErrorResult,
  toolResult,
} from './helpers'
import type { IntentTool } from './narrate'
import {
  createBuildBootstrapPayload,
  type BuildBootstrapPayloadFn,
} from './bootstrap-payload'
import { mergeCsp } from './csp'
import {
  SOLVAPAY_OVERVIEW_MARKDOWN,
  SOLVAPAY_OVERVIEW_MIME_TYPE,
  SOLVAPAY_OVERVIEW_URI,
} from './resources/overview'
import { MCP_TOOL_NAMES } from './tool-names'
import { SOLVAPAY_MCP_VIEW_KINDS, TOOL_FOR_VIEW } from './types'
import type {
  McpToolExtra,
  SolvaPayCallToolResult,
  SolvaPayDocsResourceDescriptor,
  SolvaPayMcpCsp,
  SolvaPayMcpViewKind,
  SolvaPayPromptDescriptor,
  SolvaPayPromptResult,
  SolvaPayResourceDescriptor,
  SolvaPayToolAnnotations,
  SolvaPayToolDescriptor,
} from './types'

/**
 * All SolvaPay tools talk to the SolvaPay backend, so `openWorldHint`
 * is universal. This helper stamps it on every annotation set and keeps
 * each call site focused on the read/destructive/idempotent decision.
 */
const solvapayTool = (
  hints: Omit<SolvaPayToolAnnotations, 'openWorldHint'>,
): SolvaPayToolAnnotations => ({ openWorldHint: true, ...hints })

/**
 * Per-view annotation map for the intent tools registered via
 * `pushIntentTool`. Keep aligned with `TOOL_FOR_VIEW`.
 */
const INTENT_TOOL_ANNOTATIONS: Record<keyof typeof TOOL_FOR_VIEW, SolvaPayToolAnnotations> = {
  account: solvapayTool({ readOnlyHint: true, idempotentHint: true }),
  topup: solvapayTool({ destructiveHint: true }),
  checkout: solvapayTool({ destructiveHint: true }),
}

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
   * Slash-command prompts that hosts with prompt support (Claude
   * Desktop, Cursor, etc.) surface as `/upgrade`, `/manage_account`,
   * `/topup`, and `/activate_plan`. Hosts without prompt support
   * silently ignore the list — registration is purely additive.
   */
  prompts: SolvaPayPromptDescriptor[]
  /**
   * Narrated docs resources — agent-facing "read me first" content
   * served over `docs://solvapay/*`. Lives alongside the UI resource so
   * agents can `resources/read` before trying a tool.
   */
  docsResources: SolvaPayDocsResourceDescriptor[]
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
      // Every intent tool accepts an optional `mode` so users /
      // agents on any host can opt into text-only responses (or
      // suppress the narrated markdown when they know the host is
      // rendering the UI iframe). Default `'auto'` emits both.
      inputSchema: { mode: z.enum(['ui', 'text', 'auto']).optional() },
      meta: toolMeta,
      annotations: INTENT_TOOL_ANNOTATIONS[view],
      handler: async (args, extra) =>
        trace(name, args, extra, async () => {
          const mode = parseMode(args.mode)
          const data = await buildBootstrapPayload(view, extra)
          return narratedToolResult(name as IntentTool, data, mode, toolMeta)
        }),
    })
  }

  const MODE_HINT =
    " By default renders the UI iframe with a one-line placeholder; pass `mode: 'text'` for a markdown-only summary on CLI / text-only hosts, or `mode: 'auto'` to include both."

  pushIntentTool(
    'checkout',
    'Upgrade plan',
    'Start or change a paid plan for the current customer. On UI hosts this opens the embedded checkout; on text hosts returns a markdown summary with a checkout URL. Also available: manage_account (current plan + cancel/reactivate), activate_plan (pick or activate a specific plan), topup (add credits).' +
      MODE_HINT,
  )
  pushIntentTool(
    'account',
    'Manage account',
    "Show or manage the current customer's SolvaPay account: plan, balance, usage, payment method, cancel/reactivate auto-renewal. On UI hosts this opens the embedded account view; on text hosts returns a markdown summary. Also available: upgrade (start/change a paid plan), activate_plan (pick or activate), topup (add credits)." +
      MODE_HINT,
  )
  pushIntentTool(
    'topup',
    'Top up credits',
    'Add SolvaPay credits for the current customer. On UI hosts this opens the embedded top-up flow; on text hosts returns a markdown summary with a top-up URL. Also available: manage_account (current plan + balance + usage), upgrade (switch to a recurring plan).' +
      MODE_HINT,
  )
  // `activate_plan` is registered below (transport section) as a
  // dual-audience tool that handles both the picker bootstrap (no
  // planRef) and smart activation (planRef provided), replacing the
  // legacy `open_plan_activation` intent. The picker bootstrap now
  // surfaces inside the `checkout` view (the tabbed shell and its
  // dedicated activate surface are gone).

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
    annotations: solvapayTool({}),
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
    annotations: solvapayTool({}),
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
    annotations: solvapayTool({ destructiveHint: true }),
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
    annotations: solvapayTool({ readOnlyHint: true, idempotentHint: true }),
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
    annotations: solvapayTool({}),
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
    annotations: solvapayTool({ destructiveHint: true, idempotentHint: true }),
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
    annotations: solvapayTool({ idempotentHint: true }),
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
      'Activate a plan for the current customer. With a `planRef`: free plans activate immediately; usage-based plans activate when the balance covers the configured usage; paid plans return a markdown checkout link on text hosts or open the embedded checkout on UI hosts. Without a `planRef`: returns the available plans so the customer can pick — UI hosts render the embedded checkout picker, text hosts see a plans list. Also available: upgrade (direct to checkout), manage_account (current plan + usage), topup (add credits).' +
      MODE_HINT,
    inputSchema: {
      productRef: z.string().optional(),
      planRef: z.string().optional(),
      mode: z.enum(['ui', 'text', 'auto']).optional(),
    },
    meta: toolMeta,
    annotations: solvapayTool({}),
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.activatePlan, args, extra, async () => {
        const effectiveProduct =
          typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
        const planRef = typeof args.planRef === 'string' && args.planRef ? args.planRef : undefined
        const mode = parseMode(args.mode)

        // No plan picked yet — return the picker bootstrap with
        // `view: 'checkout'` so the React shell opens the checkout
        // surface's embedded plan picker (the merged Activate/Plan
        // surface). Text-only hosts narrate the markdown summary
        // listing the available plans. Respect the `views` filter so
        // consumers that disable checkout don't accidentally expose the
        // picker as an alternate entry point.
        if (!planRef) {
          if (!enabledViews.has('checkout')) {
            return toolErrorResult({
              error: 'activate_plan requires a planRef on this server',
              status: 400,
              details:
                'The checkout view (where the plan picker lives) is not enabled on this server. Pass `planRef` to activate a specific plan, or re-enable the "checkout" view via the `views` option.',
            })
          }
          return narratedToolResult(
            MCP_TOOL_NAMES.activatePlan as IntentTool,
            await buildBootstrapPayload('checkout', extra),
            mode,
            toolMeta,
          )
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

  const prompts = buildSolvaPayPrompts({ enabledViews })

  const docsResources: SolvaPayDocsResourceDescriptor[] = [
    {
      uri: SOLVAPAY_OVERVIEW_URI,
      name: 'SolvaPay MCP — overview',
      title: 'SolvaPay overview',
      description:
        'Agent-facing "start here" doc — explains the five intent tools, dual-audience fallback, and auth model before any tool is called.',
      mimeType: SOLVAPAY_OVERVIEW_MIME_TYPE,
      readBody: () => SOLVAPAY_OVERVIEW_MARKDOWN,
    },
  ]

  return { tools, resource, prompts, docsResources, buildBootstrapPayload }
}

/**
 * Build the framework-neutral slash-command prompt descriptors for the
 * five SolvaPay intent tools. Exposed standalone so adapters that don't
 * want the full descriptor bundle (or want to register prompts on an
 * already-built server) can still pick them up.
 *
 * Each prompt is intentionally one `user` message that mirrors how a
 * human would invoke the intent — this makes slash-commands feel like
 * natural shortcuts, and keeps the prompts compatible with text hosts
 * that don't expose the MCP UI shell.
 */
export function buildSolvaPayPrompts(
  options: { enabledViews?: Set<SolvaPayMcpViewKind> } = {},
): SolvaPayPromptDescriptor[] {
  const enabled =
    options.enabledViews ?? new Set<SolvaPayMcpViewKind>(DEFAULT_VIEWS)

  const prompts: SolvaPayPromptDescriptor[] = []

  const userMessage = (text: string): SolvaPayPromptResult => ({
    messages: [{ role: 'user', content: { type: 'text', text } }],
  })

  if (enabled.has('checkout')) {
    prompts.push({
      name: MCP_TOOL_NAMES.upgrade,
      title: 'Upgrade plan',
      description: 'Start or change a paid plan for the current customer.',
      argsSchema: { planRef: z.string().optional() },
      handler: async ({ planRef }) =>
        userMessage(
          typeof planRef === 'string' && planRef
            ? `Activate plan ${planRef} for me.`
            : 'Show me the upgrade options for my SolvaPay account.',
        ),
    })
  }

  if (enabled.has('account')) {
    prompts.push({
      name: MCP_TOOL_NAMES.manageAccount,
      title: 'Manage account',
      description:
        'Show the current plan, balance, payment method, and cancel/reactivate controls for the current customer.',
      handler: async () => userMessage('Show me my SolvaPay account.'),
    })
  }

  if (enabled.has('topup')) {
    prompts.push({
      name: MCP_TOOL_NAMES.topup,
      title: 'Top up credits',
      description: 'Add SolvaPay credits to the current customer.',
      argsSchema: { amount: z.string().optional() },
      handler: async ({ amount }) =>
        userMessage(
          typeof amount === 'string' && amount
            ? `Top up my SolvaPay credits by ${amount}.`
            : 'I want to top up my SolvaPay credits.',
        ),
    })
  }

  // `activate_plan` gets a prompt whenever the checkout view is enabled
  // (the picker bootstrap lives there now). When checkout is disabled
  // the prompt is pointless — `activate_plan` without a planRef would
  // just error.
  if (enabled.has('checkout')) {
    prompts.push({
      name: MCP_TOOL_NAMES.activatePlan,
      title: 'Activate plan',
      description: 'Pick a plan to activate, or activate a specific plan by ref.',
      argsSchema: { planRef: z.string().optional() },
      handler: async ({ planRef }) =>
        userMessage(
          typeof planRef === 'string' && planRef
            ? `Activate plan ${planRef} on my SolvaPay account.`
            : 'What plans can I activate on my SolvaPay account?',
        ),
    })
  }

  return prompts
}
