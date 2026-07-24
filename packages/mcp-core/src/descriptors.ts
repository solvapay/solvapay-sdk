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
import { createBuildBootstrapPayload, type BuildBootstrapPayloadFn } from './bootstrap-payload'
import { mergeCsp } from './csp'
import { SOLVAPAY_BOOTSTRAP_MIME_TYPE, SOLVAPAY_BOOTSTRAP_URI } from './resources/bootstrap'
import {
  SOLVAPAY_OVERVIEW_MARKDOWN,
  SOLVAPAY_OVERVIEW_MIME_TYPE,
  SOLVAPAY_OVERVIEW_URI,
} from './resources/overview'
import {
  buildPromptDescriptorMetadata,
  buildPromptUserMessage,
  buildToolDescriptorMetadata,
  deriveIcons,
  validatePublicBaseUrl,
} from './native-mcp'
import { MCP_TOOL_NAMES } from './tool-names'
import { SOLVAPAY_MCP_VIEW_KINDS, TOOL_FOR_VIEW } from './types'
import type {
  McpToolExtra,
  SolvaPayBootstrapResourceDescriptor,
  SolvaPayCallToolResult,
  SolvaPayDocsResourceDescriptor,
  SolvaPayMcpCsp,
  SolvaPayMcpViewKind,
  SolvaPayMerchantBranding,
  SolvaPayPromptDescriptor,
  SolvaPayResourceDescriptor,
  SolvaPayToolDescriptor,
} from './types'

export { deriveIcons }

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

  const publicBaseUrlError = validatePublicBaseUrl(publicBaseUrl)
  if (publicBaseUrlError) {
    throw new Error(publicBaseUrlError)
  }

  if (!htmlPath && !readHtml) {
    throw new Error(
      'buildSolvaPayDescriptors: either `htmlPath` (node) or `readHtml` (edge) must be provided.',
    )
  }

  // Runtime `_meta` stamped onto intent-tool results (descriptor-level
  // meta for transport tools comes from `buildToolDescriptorMetadata`).
  const toolMeta = { ui: { resourceUri } }
  const enabledViews = new Set<SolvaPayMcpViewKind>(views)
  const metadataByName = new Map(
    buildToolDescriptorMetadata({ resourceUri, views, branding }).map(m => [m.name, m]),
  )
  const tools: SolvaPayToolDescriptor[] = []

  // Attach handlers + schemas onto pure metadata so the source of truth
  // for name/title/description/annotations/meta/icons stays single.
  const pushTool = (
    name: string,
    extras: Omit<
      SolvaPayToolDescriptor,
      'name' | 'title' | 'description' | 'annotations' | 'meta' | 'icons'
    >,
  ): void => {
    const meta = metadataByName.get(name)
    if (!meta) {
      throw new Error(`buildSolvaPayDescriptors: missing metadata for tool ${name}`)
    }
    tools.push({
      name: meta.name,
      ...(meta.title !== undefined ? { title: meta.title } : {}),
      description: meta.description,
      annotations: meta.annotations,
      meta: meta.meta,
      ...(meta.icons !== undefined ? { icons: meta.icons } : {}),
      ...extras,
    })
  }

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

  const pushIntentTool = (view: keyof typeof TOOL_FOR_VIEW) => {
    if (!enabledViews.has(view)) return
    const name = TOOL_FOR_VIEW[view]
    pushTool(name, {
      // Every intent tool accepts an optional `mode` so users /
      // agents on any host can opt into text-only responses (or
      // suppress the narrated markdown when they know the host is
      // rendering the UI iframe). Default `'auto'` emits both.
      inputSchema: { mode: z.enum(['ui', 'text', 'auto']).optional() },
      handler: async (args, extra) =>
        trace(name, args, extra, async () => {
          const mode = parseMode(args.mode)
          const data = await buildBootstrapPayload(view, extra)
          return narratedToolResult(name as IntentTool, data, mode, {
            ...toolMeta,
            'openai/widgetSessionId': crypto.randomUUID(),
          })
        }),
    })
  }

  pushIntentTool('checkout')
  pushIntentTool('account')
  pushIntentTool('topup')
  // `activate_plan` is registered below (transport section) as a
  // dual-audience tool that handles both the picker bootstrap (no
  // planRef) and smart activation (planRef provided), replacing the
  // legacy `open_plan_activation` intent. The picker bootstrap now
  // surfaces inside the `checkout` view (the tabbed shell and its
  // dedicated activate surface are gone).

  // Paywall responses are text-only narrations on `content[0].text`
  // with the structured gate riding on `structuredContent` (see
  // `buildPayableHandler` and `paywallToolResult`). No dedicated
  // `open_paywall` tool exists — hosts never open the widget iframe
  // on a gate, and the LLM recovers by calling the `upgrade` /
  // `topup` / `activate_plan` intent tool named inline in the
  // narration.

  // ------- transport tools -------

  pushTool(MCP_TOOL_NAMES.createCheckoutSession, {
    inputSchema: {
      planRef: z.string().optional(),
      productRef: z.string().optional(),
    },
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

  pushTool(MCP_TOOL_NAMES.createPayment, {
    inputSchema: {
      planRef: z.string(),
      productRef: z.string(),
      currency: z.string().optional(),
    },
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

  pushTool(MCP_TOOL_NAMES.processPayment, {
    inputSchema: {
      paymentIntentId: z.string(),
      productRef: z.string(),
      planRef: z.string().optional(),
    },
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

  pushTool(MCP_TOOL_NAMES.createCustomerSession, {
    inputSchema: {},
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

  pushTool(MCP_TOOL_NAMES.createTopupPayment, {
    inputSchema: {
      amount: z.number().int().positive(),
      currency: z.string(),
      description: z.string().optional(),
    },
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

  pushTool(MCP_TOOL_NAMES.attachBusinessDetails, {
    inputSchema: {
      paymentIntentId: z.string(),
      isBusiness: z.boolean(),
      businessName: z.string().optional(),
      country: z.string().optional(),
      taxId: z.string().optional(),
      taxIdType: z.enum(['eu_vat', 'gb_vat', 'us_ein']).optional(),
    },
    handler: async (args, extra) =>
      trace(MCP_TOOL_NAMES.attachBusinessDetails, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const paymentIntentId = typeof args.paymentIntentId === 'string' ? args.paymentIntentId : ''
        const isBusiness = args.isBusiness === true
        const businessName = typeof args.businessName === 'string' ? args.businessName : undefined
        const country = typeof args.country === 'string' ? args.country : undefined
        const taxId = typeof args.taxId === 'string' ? args.taxId : undefined
        const taxIdType =
          args.taxIdType === 'eu_vat' || args.taxIdType === 'gb_vat' || args.taxIdType === 'us_ein'
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

  pushTool(MCP_TOOL_NAMES.cancelRenewal, {
    inputSchema: {
      purchaseRef: z.string(),
      reason: z.string().optional(),
    },
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

  pushTool(MCP_TOOL_NAMES.reactivateRenewal, {
    inputSchema: { purchaseRef: z.string() },
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

  pushTool(MCP_TOOL_NAMES.activatePlan, {
    inputSchema: {
      productRef: z.string().optional(),
      planRef: z.string().optional(),
      mode: z.enum(['ui', 'text', 'auto']).optional(),
    },
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
            { ...toolMeta, 'openai/widgetSessionId': crypto.randomUUID() },
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
        'Agent-facing "start here" doc — explains the five intent tools, dual-audience fallback, and auth model before any tool is called.',
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
  const views = options.enabledViews ? [...options.enabledViews] : DEFAULT_VIEWS
  const metadata = buildPromptDescriptorMetadata({ views })
  const prompts: SolvaPayPromptDescriptor[] = []

  for (const meta of metadata) {
    if (meta.name === MCP_TOOL_NAMES.upgrade) {
      prompts.push({
        name: meta.name,
        title: meta.title,
        description: meta.description,
        argsSchema: { planRef: z.string().optional() },
        handler: async args => buildPromptUserMessage(MCP_TOOL_NAMES.upgrade, args),
      })
      continue
    }
    if (meta.name === MCP_TOOL_NAMES.manageAccount) {
      prompts.push({
        name: meta.name,
        title: meta.title,
        description: meta.description,
        handler: async () => buildPromptUserMessage(MCP_TOOL_NAMES.manageAccount, {}),
      })
      continue
    }
    if (meta.name === MCP_TOOL_NAMES.topup) {
      prompts.push({
        name: meta.name,
        title: meta.title,
        description: meta.description,
        argsSchema: { amount: z.string().optional() },
        handler: async args => buildPromptUserMessage(MCP_TOOL_NAMES.topup, args),
      })
      continue
    }
    prompts.push({
      name: meta.name,
      title: meta.title,
      description: meta.description,
      argsSchema: { planRef: z.string().optional() },
      handler: async args => buildPromptUserMessage(MCP_TOOL_NAMES.activatePlan, args),
    })
  }

  return prompts
}
