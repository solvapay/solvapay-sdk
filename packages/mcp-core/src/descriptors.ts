/**
 * `buildSolvaPayDescriptors(options)` — framework-neutral tool surface
 * builder that every SolvaPay MCP adapter (`@solvapay/mcp`, future
 * `@solvapay/mcp-fastmcp`, raw JSON-RPC adapters) maps onto its own
 * registration API.
 *
 * Body is lifted from the original
 * `packages/server/src/mcp/server.ts#createSolvaPayMcpServer`. The only
 * mechanical difference: instead of calling `registerAppTool(server, ...)`,
 * we push `{ name, handler, ... }` onto a `tools[]` array the adapter
 * iterates.
 *
 * ----
 *
 * `_meta["openai/widgetSessionId"]` workaround. Every intent-tool
 * response stamps a freshly-minted UUID on `_meta["openai/widgetSessionId"]`.
 * This is a low-risk forward-looking workaround for the ChatGPT MCP
 * connector's stale `link_<id>` routing bug, where the host returns
 * `-32000 MCP Resource not found` on the second `tools/call` of a
 * session even though the call never reaches the server. A fresh UUID
 * per invocation gives the host a routing key that changes every call,
 * which the OpenAI Apps SDK community thread reports unsticks the
 * failure mode.
 *
 * Sources:
 *   - https://community.openai.com/t/connector-tool-calls-generating-fresh-mcp-session-each-invocation/1364975
 *   - https://github.com/openai/openai-apps-sdk-examples/issues/165
 *   - https://developers.openai.com/apps-sdk/reference/ (`_meta` payload)
 *   - openai/openai-apps-sdk-examples shopping_cart_python uses the
 *     same `meta["openai/widgetSessionId"]` shape.
 *
 * Removable once the upstream bug ships a fix; safe on any host that
 * doesn't consume the key.
 */

import { assertValidProductRef } from '@solvapay/core'
import {
  activatePlanCore,
  cancelPurchaseCore,
  createCheckoutSessionCore,
  createCustomerSessionCore,
  createPaymentIntentCore,
  createTopupPaymentIntentCore,
  attachBusinessDetailsCore,
  isErrorResult,
  processPaymentIntentCore,
  reactivatePurchaseCore,
  type SolvaPay,
} from '@solvapay/server'
import { z } from 'zod'
import { BootstrapPayloadSchema } from './bootstrap-schema'
import { logMcpConfigOnce } from './config-log'
import {
  buildSolvaPayRequest,
  defaultGetCustomerRef as defaultGetCustomerRefHelper,
  narratedToolResult,
  parseMode,
  previewJson,
  toolErrorResult,
  toolResult,
} from './helpers'
import { createBuildBootstrapPayload, type BuildBootstrapPayloadFn } from './bootstrap-payload'
import { deriveDefaultView } from './derive-view'
import { mergeCsp } from './csp'
import {
  SOLVAPAY_BOOTSTRAP_MIME_TYPE,
  SOLVAPAY_BOOTSTRAP_URI,
} from './resources/bootstrap'
import {
  SOLVAPAY_OVERVIEW_MARKDOWN,
  SOLVAPAY_OVERVIEW_MIME_TYPE,
  SOLVAPAY_OVERVIEW_URI,
} from './resources/overview'
import { INTENT_TOOL_NAMES, MCP_PROMPT_NAMES, MCP_TOOL_NAMES, VIEWER_TOOL_NAME } from './tool-names'
import { SOLVAPAY_MCP_VIEW_KINDS } from './types'
import type {
  McpToolExtra,
  SolvaPayBootstrapResourceDescriptor,
  SolvaPayCallToolResult,
  SolvaPayDocsResourceDescriptor,
  SolvaPayMcpCsp,
  SolvaPayMcpViewKind,
  SolvaPayMerchantBranding,
  SolvaPayPromptDescriptor,
  SolvaPayPromptResult,
  SolvaPayResourceDescriptor,
  SolvaPayToolAnnotations,
  SolvaPayToolDescriptor,
  SolvaPayToolIcon,
} from './types'

/**
 * Project `SolvaPayMerchantBranding` into an `icons[]` array suitable
 * for MCP host chrome — either the per-tool `SolvaPayToolDescriptor`
 * or the server-level `Implementation.icons[]` returned at
 * `initialize`. Prefers the square `iconUrl` (expected shape for
 * avatar slots); falls back to the landscape `logoUrl` with a note
 * that hosts may need to letterbox. Returns `undefined` when neither
 * asset is set.
 *
 * Exported so the MCP adapter (`@solvapay/mcp`) can reuse the same
 * branding → icon projection when building the server-level
 * `Implementation` payload, keeping per-tool and server-wide icons in
 * lock-step.
 */
export function deriveIcons(
  branding: SolvaPayMerchantBranding | undefined,
): SolvaPayToolIcon[] | undefined {
  if (!branding) return undefined
  const assets: SolvaPayToolIcon[] = []
  if (branding.iconUrl) {
    assets.push({ src: branding.iconUrl, sizes: ['any', '512x512'] })
  } else if (branding.logoUrl) {
    assets.push({ src: branding.logoUrl })
  }
  return assets.length > 0 ? assets : undefined
}

/**
 * All SolvaPay tools talk to the SolvaPay backend, so `openWorldHint`
 * is universal. This helper stamps it on every annotation set and keeps
 * each call site focused on the read/destructive/idempotent decision.
 */
const solvapayTool = (
  hints: Omit<SolvaPayToolAnnotations, 'openWorldHint'>,
): SolvaPayToolAnnotations => ({ openWorldHint: true, ...hints })

const VIEWER_ANNOTATIONS: SolvaPayToolAnnotations = solvapayTool({
  readOnlyHint: true,
  idempotentHint: true,
})

const VIEW_PARAM_DESCRIPTION =
  'Landing surface. checkout: user says "upgrade", "change plan", "buy", or "subscribe". account: user says "my account", "current plan", "cancel", or "billing". topup: user says "top up", "add credits", or "buy credits". Omit to let the server pick (no plan → checkout, out of credits → topup, else account).'

const VIEWER_DESCRIPTION =
  'Call when the user says "upgrade", "change plan", "buy", "subscribe", "my account", "current plan", "cancel", "billing", "top up", "add credits", or "buy credits". Opens the SolvaPay billing surface. Pass `view` to pick the landing screen; omit it to let the server pick (no plan → checkout, out of credits → topup, else account). Read-only snapshot — charges happen after the customer confirms.'

const INTENT_MODE_SCHEMA = z
  .enum(['ui', 'text', 'auto'])
  .optional()
  .describe(
    "Default `mode: 'auto'` returns a self-sufficient text summary (plan, price, https checkout URL) and still opens the iframe on UI hosts. Pass `mode: 'text'` to strip the iframe, or `mode: 'ui'` for a one-line placeholder that still includes the checkout URL.",
  )

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
  /** Which viewer surfaces the `account` tool may open. Defaults to every known view. */
  views?: SolvaPayMcpViewKind[]
  /** Additional CSP allow-lists merged with the Stripe baseline. */
  csp?: SolvaPayMcpCsp
  /**
   * Configured SolvaPay API origin (e.g. `'https://api.solvapay.com'`
   * or `'https://api-dev.solvapay.com'`). When provided, the origin is
   * auto-appended to `csp.resourceDomains` + `csp.connectDomains` so
   * the widget iframe can load merchant branding images (served by
   * `GET /v1/files/public/provider-assets/...`) and make XHR / fetch
   * calls back to the API without the integrator hand-extending the
   * CSP. Pass the same value you pass to `createSolvaPay({ apiBaseUrl })`.
   */
  apiBaseUrl?: string
  /**
   * Override customer-ref extraction. Defaults to reading
   * `extra.http.authInfo.extra.customer_ref` (populated by the MCP
   * OAuth bridge), falling back to the SDK v1 flat `extra.authInfo`.
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
  /**
   * Merchant branding used to personalise the MCP host chrome — when
   * provided, every emitted tool descriptor carries an `icons[]` the
   * adapter surfaces on `tools/list` so hosts can replace the default
   * globe / placeholder with the merchant's mark. Prefer fetching the
   * SDK merchant payload at server startup (`getMerchantCore` exposes
   * `iconUrl` / `logoUrl` / `displayName`) and passing the result in.
   */
  branding?: SolvaPayMerchantBranding
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
   * Idempotent bootstrap snapshot at `solvapay://bootstrap.json` — the
   * widget reads this when the host scrubs `structuredContent` from the
   * opening tool-result notification.
   */
  bootstrapResource: SolvaPayBootstrapResourceDescriptor
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
 * exported by `@solvapay/mcp` (or any future adapter package).
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
    apiBaseUrl,
    getCustomerRef = defaultGetCustomerRefHelper,
    onToolCall,
    onToolResult,
    branding,
  } = options
  const toolIcons = deriveIcons(branding)

  if (!/^https?:\/\//i.test(publicBaseUrl)) {
    throw new Error(
      'buildSolvaPayDescriptors: publicBaseUrl must be an http(s) URL (Stripe confirmPayment rejects `ui://`).',
    )
  }

  assertValidProductRef(productRef, 'buildSolvaPayDescriptors')

  if (!htmlPath && !readHtml) {
    throw new Error(
      'buildSolvaPayDescriptors: either `htmlPath` (node) or `readHtml` (edge) must be provided.',
    )
  }

  logMcpConfigOnce({
    apiBaseUrl: apiBaseUrl ?? '(unset)',
    productRef,
    publicBaseUrl,
  })

  const toolMeta = { ui: { resourceUri } }
  // State-change tools that need a server round-trip from inside the
  // embedded UI but offer no LLM-facing use.
  // `visibility: ['app']` is the SEP-1865 signal MCP Apps hosts read to
  // keep these transport tools out of the model's tool list while the
  // embedded iframe can still call them (`app` is included). The
  // proprietary `audience` tag stays for the server-side
  // `hideToolsByAudience` opt-in on non-SEP-1865 hosts.
  const uiToolMeta = {
    ui: { resourceUri, visibility: ['app'] as const },
    audience: 'ui' as const,
    // ChatGPT Apps SDK rejects iframe `callTool` unless this flag is set.
    // Dual-stamp with `ui.visibility: ['app']` for MCP Apps hosts.
    'openai/widgetAccessible': true as const,
    // ChatGPT advertises `experimental: { 'openai/visibility': { enabled: true } }`
    // and resolves model visibility from this legacy string, not from
    // `ui.visibility`. Its default is `'public'`, so omitting it put every
    // transport tool into the model's context. Paired with
    // `openai/widgetAccessible` above, which is what keeps them callable
    // from the iframe.
    'openai/visibility': 'private' as const,
  }
  const enabledViews = new Set<SolvaPayMcpViewKind>(views)
  const tools: SolvaPayToolDescriptor[] = []

  // Push a tool into the emitted list, augmented with the shared
  // brand-icon set so every advertised tool carries the same merchant
  // mark in `tools/list`.
  const pushTool = (descriptor: SolvaPayToolDescriptor): void => {
    tools.push(toolIcons ? { ...descriptor, icons: toolIcons } : descriptor)
  }

  const UI_ONLY_PREFIX = `UI-only; agents should prefer ${INTENT_TOOL_NAMES.map(name => `\`${name}\``).join(' / ')}. `

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
      // Errors thrown from `buildBootstrapPayload` and downstream
      // helpers can carry an upstream HTTP `status` and a
      // human-readable `details` string (see
      // `createBootstrapMerchantError` in `bootstrap-payload.ts`).
      // Read them off the caught value when present so the recovery
      // message reaches `content[0].text` and `structuredContent.status`
      // matches the upstream — otherwise both used to collapse to 500
      // / `previewJson(err)`.
      const carrier =
        err && typeof err === 'object'
          ? (err as { status?: unknown; details?: unknown })
          : undefined
      const status = typeof carrier?.status === 'number' ? carrier.status : 500
      const message = err instanceof Error ? err.message : String(err)
      const details =
        typeof carrier?.details === 'string' && carrier.details.length > 0
          ? carrier.details
          : err instanceof Error
            ? err.message
            : previewJson(err)
      const errorResult = toolErrorResult({
        error: message,
        status,
        details,
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

  const enabledViewList = SOLVAPAY_MCP_VIEW_KINDS.filter(view => enabledViews.has(view))
  if (enabledViewList.length > 0) {
    const viewEnum = z
      .enum(enabledViewList as [SolvaPayMcpViewKind, ...SolvaPayMcpViewKind[]])
      .optional()
      .describe(VIEW_PARAM_DESCRIPTION)
    pushTool({
      name: VIEWER_TOOL_NAME,
      title: 'Account',
      description: VIEWER_DESCRIPTION,
      inputSchema: { view: viewEnum, mode: INTENT_MODE_SCHEMA },
      outputSchema: BootstrapPayloadSchema,
      meta: toolMeta,
      annotations: VIEWER_ANNOTATIONS,
      handler: async (args, extra) =>
        trace(VIEWER_TOOL_NAME, args, extra, async () => {
          const requested =
            args.view === 'checkout' || args.view === 'account' || args.view === 'topup'
              ? args.view
              : undefined
          if (requested !== undefined && !enabledViews.has(requested)) {
            return toolErrorResult({
              error: `view '${requested}' is not enabled on this server`,
              status: 400,
              details: `Enabled views: ${enabledViewList.join(', ')}. Pass one of those, or omit view to let the server pick.`,
            })
          }
          const mode = parseMode(args.mode)
          const data = await buildBootstrapPayload(requested ?? 'account', extra)
          const view = requested ?? deriveDefaultView(data, enabledViews)
          data.view = view
          return narratedToolResult(view, data, mode, {
            ...toolMeta,
            'openai/widgetSessionId': crypto.randomUUID(),
          })
        }),
    })
  }

  // Paywall responses are text-only narrations on `content[0].text`
  // with the structured gate riding on `structuredContent` (see
  // `buildPayableHandler` and `paywallToolResult`). No dedicated
  // `open_paywall` tool exists — hosts never open the widget iframe
  // on a gate, and the LLM recovers by calling the `account` viewer
  // (or `activate_plan` when a specific planRef is known) named
  // inline in the narration.

  // ------- transport tools -------

  pushTool({
    name: MCP_TOOL_NAMES.createCheckoutSession,
    description:
      UI_ONLY_PREFIX +
      'Create a SolvaPay hosted checkout session and return its URL. The UI opens this URL in a new tab when Stripe Elements is blocked by the host sandbox.',
    inputSchema: {
      planRef: z.string().optional(),
      productRef: z.string().optional(),
    },
    meta: uiToolMeta,
    annotations: solvapayTool({ readOnlyHint: false, destructiveHint: false }),
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

  pushTool({
    name: MCP_TOOL_NAMES.createPayment,
    description:
      UI_ONLY_PREFIX +
      'Create a Stripe payment intent for the authenticated customer to purchase a plan. Returns { clientSecret, publishableKey, accountId?, customerRef } for confirmation with Stripe Elements in the app UI.',
    inputSchema: {
      planRef: z.string(),
      productRef: z.string(),
      currency: z.string().optional(),
    },
    meta: uiToolMeta,
    annotations: solvapayTool({ readOnlyHint: false, destructiveHint: false }),
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.createPayment, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const planRef = typeof args.planRef === 'string' ? args.planRef : ''
        const effectiveProduct =
          typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
        const currency =
          typeof args.currency === 'string' && args.currency ? args.currency : undefined

        const result = await createPaymentIntentCore(
          buildRequest(extra, { method: 'POST' }),
          { planRef, productRef: effectiveProduct, ...(currency && { currency }) },
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  })

  pushTool({
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

  pushTool({
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

  pushTool({
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
    annotations: solvapayTool({ readOnlyHint: false, destructiveHint: false }),
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

  pushTool({
    name: MCP_TOOL_NAMES.attachBusinessDetails,
    description:
      UI_ONLY_PREFIX +
      'Attach business purchase details to a payment intent and retrieve the computed tax breakdown.',
    inputSchema: {
      paymentIntentId: z.string(),
      isBusiness: z.boolean(),
      businessName: z.string().optional(),
      country: z.string().optional(),
      taxId: z.string().optional(),
      taxIdType: z.enum(['eu_vat', 'gb_vat', 'us_ein']).optional(),
    },
    meta: uiToolMeta,
    annotations: solvapayTool({ readOnlyHint: false, destructiveHint: false, idempotentHint: true }),
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.attachBusinessDetails, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const paymentIntentId =
          typeof args.paymentIntentId === 'string' ? args.paymentIntentId : ''
        const isBusiness = args.isBusiness === true
        const businessName =
          typeof args.businessName === 'string' ? args.businessName : undefined
        const country = typeof args.country === 'string' ? args.country : undefined
        const taxId = typeof args.taxId === 'string' ? args.taxId : undefined
        const taxIdType =
          args.taxIdType === 'eu_vat' ||
          args.taxIdType === 'gb_vat' ||
          args.taxIdType === 'us_ein'
            ? args.taxIdType
            : undefined

        const result = await attachBusinessDetailsCore(
          buildRequest(extra, { method: 'POST' }),
          {
            paymentIntentId,
            customerRef: auth,
            isBusiness,
            ...(businessName !== undefined && { businessName }),
            ...(country !== undefined && { country }),
            ...(taxId !== undefined && { taxId }),
            ...(taxIdType !== undefined && { taxIdType }),
          },
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  })

  pushTool({
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

  pushTool({
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

  pushTool({
    name: MCP_TOOL_NAMES.activatePlan,
    title: 'Activate plan',
    description:
      'Call when the user says "activate" and a specific `planRef` is known. Free plans activate immediately; usage-based plans activate when the balance covers usage; paid plans open checkout. Requires `planRef` — to list or pick a plan, call `account` with view: "checkout".',
    inputSchema: {
      planRef: z.string().describe('Plan to activate. Required.'),
      productRef: z.string().optional(),
    },
    // Dual-audience mutator: the model calls it with a planRef, and the
    // already-open widget calls it via `callServerTool`. No
    // `resourceUri` — this tool no longer returns a bootstrap, so the
    // host must not open the iframe on the call (that collision used
    // to double-fetch the snapshot).
    meta: {
      'openai/widgetAccessible': true as const,
    },
    annotations: solvapayTool({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    }),
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.activatePlan, args, extra, async () => {
        const effectiveProduct =
          typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
        const planRef = typeof args.planRef === 'string' ? args.planRef.trim() : ''
        if (!planRef) {
          return toolErrorResult({
            error: 'activate_plan requires a planRef',
            status: 400,
            details:
              'Pass `planRef` to activate a specific plan. To list plans, call `account` with view: "checkout".',
          })
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

  const resolvedCsp = mergeCsp(csp, apiBaseUrl)
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
        'Agent-facing "start here" doc — explains the two intent tools, dual-audience fallback, and auth model before any tool is called.',
      mimeType: SOLVAPAY_OVERVIEW_MIME_TYPE,
      readBody: () => SOLVAPAY_OVERVIEW_MARKDOWN,
    },
  ]

  const bootstrapResource: SolvaPayBootstrapResourceDescriptor = {
    uri: SOLVAPAY_BOOTSTRAP_URI,
    name: 'SolvaPay bootstrap',
    title: 'SolvaPay bootstrap',
    description:
      'Current merchant/product/plans/customer snapshot for the embedded UI. Widgets read this idempotently when the host scrubs structuredContent from tool results.',
    mimeType: SOLVAPAY_BOOTSTRAP_MIME_TYPE,
    // View is an echoed routing label — the widget resolves the actual
    // surface from host context (`inferViewFromHost`), so any view kind
    // produces identical merchant/product/plans/customer data.
    readPayload: extra => buildBootstrapPayload('account', extra),
  }

  return { tools, resource, prompts, docsResources, bootstrapResource, buildBootstrapPayload }
}

/**
 * Build the framework-neutral slash-command prompt descriptors for the
 * four SolvaPay intent tools. Exposed standalone so adapters that don't
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
  const enabled = options.enabledViews ?? new Set<SolvaPayMcpViewKind>(DEFAULT_VIEWS)

  const prompts: SolvaPayPromptDescriptor[] = []

  const userMessage = (text: string): SolvaPayPromptResult => ({
    messages: [{ role: 'user', content: { type: 'text', text } }],
  })

  if (enabled.has('checkout')) {
    prompts.push({
      name: MCP_PROMPT_NAMES.upgrade,
      title: 'Upgrade plan',
      description: 'Start or change a paid plan for the current customer.',
      argsSchema: { planRef: z.string().optional() },
      handler: async ({ planRef }) =>
        userMessage(
          typeof planRef === 'string' && planRef
            ? `Call the \`${VIEWER_TOOL_NAME}\` tool with view: "checkout", then activate plan ${planRef}.`
            : `Call the \`${VIEWER_TOOL_NAME}\` tool with view: "checkout" to show upgrade options.`,
        ),
    })
  }

  if (enabled.has('account')) {
    prompts.push({
      name: MCP_PROMPT_NAMES.manageAccount,
      title: 'Manage account',
      description:
        'Show the current plan, balance, payment method, and cancel/reactivate controls for the current customer.',
      handler: async () =>
        userMessage(`Call the \`${VIEWER_TOOL_NAME}\` tool with view: "account" to show my SolvaPay account.`),
    })
  }

  if (enabled.has('topup')) {
    prompts.push({
      name: MCP_PROMPT_NAMES.topup,
      title: 'Top up credits',
      description: 'Add SolvaPay credits to the current customer.',
      argsSchema: { amount: z.string().optional() },
      handler: async ({ amount }) =>
        userMessage(
          typeof amount === 'string' && amount
            ? `Call the \`${VIEWER_TOOL_NAME}\` tool with view: "topup" and top up my credits by ${amount}.`
            : `Call the \`${VIEWER_TOOL_NAME}\` tool with view: "topup" to add SolvaPay credits.`,
        ),
    })
  }

  // `/activate_plan` stays discoverable even when the picker moved to
  // the viewer. With a planRef the model should call the mutator;
  // without one, list plans via the viewer.
  prompts.push({
    name: MCP_PROMPT_NAMES.activatePlan,
    title: 'Activate plan',
    description: 'Activate a specific plan by ref, or list plans to pick from.',
    argsSchema: { planRef: z.string().optional() },
    handler: async ({ planRef }) =>
      userMessage(
        typeof planRef === 'string' && planRef
          ? `Call the \`${MCP_TOOL_NAMES.activatePlan}\` tool with planRef ${planRef}.`
          : `Call the \`${VIEWER_TOOL_NAME}\` tool with view: "checkout" to list plans I can activate.`,
      ),
  })

  return prompts
}
