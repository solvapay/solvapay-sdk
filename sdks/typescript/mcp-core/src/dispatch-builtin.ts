/**
 * Route one SolvaPay builtin tool through `mcpDispatch` when the native
 * client is present. Mock `apiClient`s used by unit tests have no composite
 * ops, so those calls stay on the TypeScript `*Core` helpers.
 */

import {
  activatePlanCore,
  attachBusinessDetailsCore,
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
import { createBuildBootstrapPayload } from './bootstrap-payload'
import {
  buildSolvaPayRequest,
  narratedToolResult,
  parseMode,
  toolErrorResult,
  toolResult,
} from './helpers'
import { MCP_TOOL_NAMES } from './tool-names'
import type { IntentTool } from './narrate'
import type { McpToolExtra, SolvaPayCallToolResult, SolvaPayMcpViewKind } from './types'

export type BuiltinDispatchConfig = {
  productRef: string
  publicBaseUrl: string
  resourceUri: string
  views: readonly SolvaPayMcpViewKind[]
}

export type DispatchSolvaPayBuiltinOptions = {
  solvaPay: SolvaPay
  name: string
  args: Record<string, unknown>
  extra: McpToolExtra | undefined
  config: BuiltinDispatchConfig
  getCustomerRef: (extra?: McpToolExtra) => string | null
}

type McpCompositeClient = {
  mcpDispatch?: (params: {
    rpc: unknown
    config: Record<string, unknown>
    authHeader?: string
  }) => Promise<unknown>
  mcpCallBuiltinTool?: (params: {
    name: string
    args: Record<string, unknown>
    config: Record<string, unknown>
    customerRef?: string | null
  }) => Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function asCallToolResult(value: unknown): SolvaPayCallToolResult {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new Error('MCP builtin returned a result without content[]')
  }
  return value as SolvaPayCallToolResult
}

function base64UrlJson(value: unknown): string {
  const json = JSON.stringify(value)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function customerBearer(customerRef: string): string {
  return `Bearer ${base64UrlJson({ alg: 'none' })}.${base64UrlJson({ sub: customerRef })}.`
}

function authHeaderFor(
  extra: McpToolExtra | undefined,
  customerRef: string | null,
): string | undefined {
  const raw = extra && typeof extra.authorization === 'string' ? extra.authorization : undefined
  if (raw?.trim()) return raw
  if (customerRef) return customerBearer(customerRef)
  return undefined
}

function unwrapDispatch(value: unknown): SolvaPayCallToolResult {
  if (!isRecord(value)) {
    throw new Error('mcpDispatch returned a non-object envelope')
  }
  if (value.kind === 'rpc' && isRecord(value.rpc)) {
    if (isRecord(value.rpc.error)) {
      const message =
        typeof value.rpc.error.message === 'string' ? value.rpc.error.message : 'MCP error'
      return toolErrorResult({ error: message, status: 500 })
    }
    return asCallToolResult(value.rpc.result)
  }
  if (value.kind === 'challenge') {
    return toolErrorResult({
      error: 'Unauthorized',
      status: typeof value.status === 'number' ? value.status : 401,
      details: 'customer_ref missing from MCP auth context',
    })
  }
  throw new Error(`unexpected mcpDispatch kind: ${String(value.kind)}`)
}

function mcpClient(solvaPay: SolvaPay): McpCompositeClient {
  return solvaPay.apiClient
}

export async function dispatchSolvaPayBuiltin(
  options: DispatchSolvaPayBuiltinOptions,
): Promise<SolvaPayCallToolResult> {
  const { solvaPay, name, args, extra, config, getCustomerRef } = options
  const customerRef = getCustomerRef(extra)
  const client = mcpClient(solvaPay)
  const toolConfig = {
    productRef: config.productRef,
    publicBaseUrl: config.publicBaseUrl,
    resourceUri: config.resourceUri,
    views: [...config.views],
  }

  if (typeof client.mcpDispatch === 'function') {
    const authHeader = authHeaderFor(extra, customerRef)
    const envelope = await client.mcpDispatch({
      rpc: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      config: {
        ...toolConfig,
        payableTools: [],
      },
      ...(authHeader !== undefined ? { authHeader } : {}),
    })
    return unwrapDispatch(envelope)
  }

  if (typeof client.mcpCallBuiltinTool === 'function') {
    return asCallToolResult(
      await client.mcpCallBuiltinTool({
        name,
        args,
        config: toolConfig,
        customerRef,
      }),
    )
  }

  return dispatchLegacyBuiltin(options)
}

async function dispatchLegacyBuiltin(
  options: DispatchSolvaPayBuiltinOptions,
): Promise<SolvaPayCallToolResult> {
  const { solvaPay, name, args, extra, config, getCustomerRef } = options
  const { productRef, publicBaseUrl, resourceUri, views } = config
  const enabledViews = new Set<SolvaPayMcpViewKind>(views)
  const toolMeta = { ui: { resourceUri } }

  const buildRequest = (
    init: { method?: string; query?: Record<string, string | undefined>; body?: unknown } = {},
  ) => buildSolvaPayRequest(extra, { ...init, getCustomerRef })

  const requireCustomerRef = (): SolvaPayCallToolResult | string => {
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

  const buildBootstrapPayload = createBuildBootstrapPayload({
    solvaPay,
    productRef,
    publicBaseUrl,
    getCustomerRef,
  })

  switch (name) {
    case MCP_TOOL_NAMES.upgrade:
    case MCP_TOOL_NAMES.manageAccount:
    case MCP_TOOL_NAMES.topup: {
      const view =
        name === MCP_TOOL_NAMES.upgrade
          ? 'checkout'
          : name === MCP_TOOL_NAMES.manageAccount
            ? 'account'
            : 'topup'
      const data = await buildBootstrapPayload(view, extra)
      return narratedToolResult(name as IntentTool, data, parseMode(args.mode), {
        ...toolMeta,
        'openai/widgetSessionId': crypto.randomUUID(),
      })
    }
    case MCP_TOOL_NAMES.createCheckoutSession: {
      const auth = requireCustomerRef()
      if (typeof auth !== 'string') return auth
      const effectiveProduct =
        typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
      const planRef = typeof args.planRef === 'string' && args.planRef ? args.planRef : undefined
      const result = await createCheckoutSessionCore(
        buildRequest({ method: 'POST' }),
        { productRef: effectiveProduct, planRef },
        { solvaPay },
      )
      return isErrorResult(result) ? toolErrorResult(result) : toolResult(result)
    }
    case MCP_TOOL_NAMES.createPayment: {
      const auth = requireCustomerRef()
      if (typeof auth !== 'string') return auth
      const planRef = typeof args.planRef === 'string' ? args.planRef : ''
      const effectiveProduct =
        typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
      const currency =
        typeof args.currency === 'string' && args.currency ? args.currency : undefined
      const result = await createPaymentIntentCore(
        buildRequest({ method: 'POST' }),
        { planRef, productRef: effectiveProduct, ...(currency && { currency }) },
        { solvaPay },
      )
      return isErrorResult(result) ? toolErrorResult(result) : toolResult(result)
    }
    case MCP_TOOL_NAMES.processPayment: {
      const auth = requireCustomerRef()
      if (typeof auth !== 'string') return auth
      const paymentIntentId = typeof args.paymentIntentId === 'string' ? args.paymentIntentId : ''
      const effectiveProduct =
        typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
      const planRef = typeof args.planRef === 'string' && args.planRef ? args.planRef : undefined
      const result = await processPaymentIntentCore(
        buildRequest({ method: 'POST' }),
        { paymentIntentId, productRef: effectiveProduct, planRef },
        { solvaPay },
      )
      return isErrorResult(result) ? toolErrorResult(result) : toolResult(result)
    }
    case MCP_TOOL_NAMES.createCustomerSession: {
      const auth = requireCustomerRef()
      if (typeof auth !== 'string') return auth
      const result = await createCustomerSessionCore(buildRequest({ method: 'POST' }), { solvaPay })
      return isErrorResult(result) ? toolErrorResult(result) : toolResult(result)
    }
    case MCP_TOOL_NAMES.createTopupPayment: {
      const auth = requireCustomerRef()
      if (typeof auth !== 'string') return auth
      const amount = typeof args.amount === 'number' ? args.amount : 0
      const currency = typeof args.currency === 'string' ? args.currency : ''
      const description = typeof args.description === 'string' ? args.description : undefined
      const result = await createTopupPaymentIntentCore(
        buildRequest({ method: 'POST' }),
        { amount, currency, description },
        { solvaPay },
      )
      return isErrorResult(result) ? toolErrorResult(result) : toolResult(result)
    }
    case MCP_TOOL_NAMES.attachBusinessDetails: {
      const auth = requireCustomerRef()
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
        buildRequest({ method: 'POST' }),
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
      return isErrorResult(result) ? toolErrorResult(result) : toolResult(result)
    }
    case MCP_TOOL_NAMES.cancelRenewal: {
      const auth = requireCustomerRef()
      if (typeof auth !== 'string') return auth
      const purchaseRef = typeof args.purchaseRef === 'string' ? args.purchaseRef : ''
      const reason = typeof args.reason === 'string' ? args.reason : undefined
      const result = await cancelPurchaseCore(
        buildRequest({ method: 'POST' }),
        { purchaseRef, reason },
        { solvaPay },
      )
      return isErrorResult(result) ? toolErrorResult(result) : toolResult(result)
    }
    case MCP_TOOL_NAMES.reactivateRenewal: {
      const auth = requireCustomerRef()
      if (typeof auth !== 'string') return auth
      const purchaseRef = typeof args.purchaseRef === 'string' ? args.purchaseRef : ''
      const result = await reactivatePurchaseCore(
        buildRequest({ method: 'POST' }),
        { purchaseRef },
        { solvaPay },
      )
      return isErrorResult(result) ? toolErrorResult(result) : toolResult(result)
    }
    case MCP_TOOL_NAMES.activatePlan: {
      const effectiveProduct =
        typeof args.productRef === 'string' && args.productRef ? args.productRef : productRef
      const planRef = typeof args.planRef === 'string' && args.planRef ? args.planRef : undefined
      const mode = parseMode(args.mode)
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
      const auth = requireCustomerRef()
      if (typeof auth !== 'string') return auth
      const result = await activatePlanCore(
        buildRequest({ method: 'POST' }),
        { productRef: effectiveProduct, planRef },
        { solvaPay },
      )
      return isErrorResult(result) ? toolErrorResult(result) : toolResult(result)
    }
    default:
      return toolErrorResult({
        error: `Unknown SolvaPay builtin: ${name}`,
        status: 400,
      })
  }
}
