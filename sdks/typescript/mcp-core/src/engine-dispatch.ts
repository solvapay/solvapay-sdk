/**
 * Shared `mcpDispatch` / `mcpResume` host loop. Transports stay
 * per-language; JSON-RPC routing does not.
 */

import { callMcpSyncOp } from './native-mcp'

export type McpEngineConfig = {
  productRef: string
  publicBaseUrl: string
  resourceUri: string
  payableTools: string[]
  mcpPath?: string
  views?: string[]
  authMode?: 'tools-call' | 'all'
  hideAudiences?: string[]
  userAgent?: string
  csp?: unknown
  apiBaseUrl?: string
  branding?: {
    brandName?: string
    iconUrl?: string
    logoUrl?: string
  }
}

export type McpEngineHttpResult = {
  status: number
  headers: Record<string, string>
  body: unknown
}

export type McpEnginePayable = {
  invoke: (args: Record<string, unknown>, customerRef: string | undefined) => Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function jsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json' }
}

function stringHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const headers: Record<string, string> = {}
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === 'string') headers[key] = val
  }
  return headers
}

export async function runMcpEngineRequest(options: {
  mcpDispatch: (params: {
    rpc: unknown
    config: Record<string, unknown>
    authHeader?: string
  }) => Promise<unknown>
  rpc: unknown
  config: McpEngineConfig
  authHeader?: string
  payables: ReadonlyMap<string, McpEnginePayable>
  onDispatch?: (rpc: unknown) => void
  onDispatched?: (result: McpEngineHttpResult, durationMs: number) => void
}): Promise<McpEngineHttpResult> {
  const { mcpDispatch, rpc, config, authHeader, payables, onDispatch, onDispatched } = options
  const started = Date.now()
  onDispatch?.(rpc)
  const envelope = await mcpDispatch({
    rpc,
    config: {
      productRef: config.productRef,
      publicBaseUrl: config.publicBaseUrl,
      resourceUri: config.resourceUri,
      payableTools: config.payableTools,
      ...(config.mcpPath !== undefined ? { mcpPath: config.mcpPath } : {}),
      ...(config.views !== undefined ? { views: config.views } : {}),
      ...(config.authMode !== undefined ? { authMode: config.authMode } : {}),
      ...(config.hideAudiences !== undefined ? { hideAudiences: config.hideAudiences } : {}),
      ...(config.userAgent !== undefined ? { userAgent: config.userAgent } : {}),
      ...(config.csp !== undefined ? { csp: config.csp } : {}),
      ...(config.apiBaseUrl !== undefined ? { apiBaseUrl: config.apiBaseUrl } : {}),
      ...(config.branding !== undefined ? { branding: config.branding } : {}),
    },
    ...(authHeader !== undefined ? { authHeader } : {}),
  })
  if (!isRecord(envelope)) {
    throw new Error('mcpDispatch returned a non-object envelope')
  }
  const kind = envelope.kind
  if (kind === 'rpc') {
    const result = { status: 200, headers: jsonHeaders(), body: envelope.rpc ?? null }
    onDispatched?.(result, Date.now() - started)
    return result
  }
  if (kind === 'challenge') {
    const result = {
      status: typeof envelope.status === 'number' ? envelope.status : 401,
      headers: stringHeaders(envelope.headers),
      body: envelope.body ?? null,
    }
    onDispatched?.(result, Date.now() - started)
    return result
  }
  if (kind === 'invokeHandler') {
    const tool = typeof envelope.tool === 'string' ? envelope.tool : ''
    const token = typeof envelope.token === 'string' ? envelope.token : ''
    if (!token) throw new Error('invokeHandler missing token')
    const payable = payables.get(tool)
    if (payable === undefined) throw new Error(`unknown payable tool: ${tool}`)
    const args = isRecord(envelope.args) ? { ...envelope.args } : {}
    const customerRef = typeof envelope.customerRef === 'string' ? envelope.customerRef : undefined
    if (customerRef !== undefined && args.customer_ref === undefined) {
      args.customer_ref = customerRef
    }
    const handlerEnvelope = await payable.invoke(args, customerRef)
    const resumed = callMcpSyncOp<Record<string, unknown>>('mcpResume', {
      token,
      handlerEnvelope,
    })
    const result = { status: 200, headers: jsonHeaders(), body: resumed.rpc ?? resumed }
    onDispatched?.(result, Date.now() - started)
    return result
  }
  throw new Error(`unexpected mcpDispatch kind: ${String(kind)}`)
}
