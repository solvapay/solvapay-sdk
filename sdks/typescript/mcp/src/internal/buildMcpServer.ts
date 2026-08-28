/**
 * Shared `McpServer` construction. Transport/session stay on the
 * official SDK; JSON-RPC routing goes through `mcpDispatch`.
 */

import { McpServer } from '@modelcontextprotocol/server'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/server'
import {
  buildSolvaPayDescriptors,
  callMcpSyncOp,
  deriveIcons,
  mcpDescriptors,
  hideToolsByAudience,
  runMcpEngineRequest,
  type BuildSolvaPayDescriptorsOptions,
  type McpEngineConfig,
  type McpEnginePayable,
  type SolvaPayDescriptorBundle,
} from '@solvapay/mcp-core'
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from './extAppsServer'
import { defaultMcpAppHtml } from '../defaultMcpAppHtml'

export interface BuildSolvaPayMcpServerOptions extends BuildSolvaPayDescriptorsOptions {
  registerPrompts?: boolean
  registerDocsResources?: boolean
  serverName?: string
  serverVersion?: string
}

export type HideToolsByAudienceConfig =
  | readonly string[]
  | {
      audiences: readonly string[]
    }

export function hideAudiencesFromConfig(
  config: HideToolsByAudienceConfig | undefined,
): string[] | undefined {
  if (!config) return undefined
  const audiences = 'audiences' in config ? config.audiences : config
  return audiences.length > 0 ? [...audiences] : undefined
}

export interface BuiltSolvaPayMcpServer {
  server: McpServer
  descriptors: SolvaPayDescriptorBundle
  payables: Map<string, McpEnginePayable>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function jsonRpcResult(body: unknown): unknown {
  if (isRecord(body) && 'result' in body) return body.result
  return body
}

function headerFromHeaders(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined
  }
  if (!isRecord(headers)) return undefined
  const titled = name
    .split('-')
    .map(part => (part.length > 0 ? `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}` : part))
    .join('-')
  const raw = headers[name] ?? headers[titled]
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0]
  return undefined
}

function userAgentFromHeaders(headers: unknown): string | undefined {
  return headerFromHeaders(headers, 'user-agent')
}

function authorizationFromHeaders(headers: unknown): string | undefined {
  return headerFromHeaders(headers, 'authorization')
}

export function userAgentFromRequestInfo(requestInfo: unknown): string | undefined {
  if (requestInfo instanceof Request) {
    return requestInfo.headers.get('user-agent') ?? undefined
  }
  if (!isRecord(requestInfo)) return undefined
  return userAgentFromHeaders(requestInfo.headers)
}

function userAgentFromExtra(
  extra: unknown,
  server?: McpServer,
  fallback?: string,
): string | undefined {
  if (extra instanceof Request) {
    return extra.headers.get('user-agent') ?? fallback ?? clientVersionUserAgent(server)
  }
  if (isRecord(extra)) {
    const fromInfo = userAgentFromRequestInfo(extra.requestInfo)
    if (fromInfo !== undefined) return fromInfo
    const fromRequest =
      extra.request instanceof Request
        ? extra.request.headers.get('user-agent') ?? undefined
        : userAgentFromHeaders(isRecord(extra.request) ? extra.request.headers : undefined)
    if (fromRequest !== undefined) return fromRequest
  }
  return fallback ?? clientVersionUserAgent(server)
}

function clientVersionUserAgent(server?: McpServer): string | undefined {
  const inner = server as unknown as {
    server?: { getClientVersion?: () => { name?: unknown } | undefined }
  }
  const name = inner.server?.getClientVersion?.()?.name
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

function authHeaderFromExtra(extra: unknown): string | undefined {
  if (extra instanceof Request) {
    return extra.headers.get('authorization') ?? undefined
  }
  if (!isRecord(extra)) return undefined
  const http = extra.http
  if (isRecord(http) && isRecord(http.authInfo) && typeof http.authInfo.token === 'string') {
    return `Bearer ${http.authInfo.token}`
  }
  if (isRecord(extra.authInfo) && typeof extra.authInfo.token === 'string') {
    return `Bearer ${extra.authInfo.token}`
  }
  if (extra.requestInfo instanceof Request) {
    const fromInfo = extra.requestInfo.headers.get('authorization')
    if (fromInfo) return fromInfo
  }
  if (extra.request instanceof Request) {
    const fromRequest = extra.request.headers.get('authorization')
    if (fromRequest) return fromRequest
  }
  if (isRecord(extra.request)) {
    return authorizationFromHeaders(extra.request.headers)
  }
  return undefined
}

function resolveMcpDispatch(
  solvaPay: BuildSolvaPayDescriptorsOptions['solvaPay'],
): (params: { rpc: unknown; config: Record<string, unknown>; authHeader?: string }) => Promise<unknown> {
  const client = solvaPay.apiClient as {
    mcpDispatch?: (params: {
      rpc: unknown
      config: Record<string, unknown>
      authHeader?: string
    }) => Promise<unknown>
  }
  if (typeof client.mcpDispatch === 'function') {
    return client.mcpDispatch.bind(client)
  }
  return async params => {
    const handled = callMcpSyncOp<Record<string, unknown>>('mcpHandleRequest', params)
    if (handled.kind === 'callBuiltin') {
      return {
        kind: 'rpc',
        rpc: {
          jsonrpc: '2.0',
          id: handled.rpcId ?? null,
          result: {
            content: [{ type: 'text', text: `builtin ${String(handled.name)}` }],
            isError: true,
          },
        },
      }
    }
    if (handled.kind === 'readResource') {
      const uri = typeof handled.uri === 'string' ? handled.uri : ''
      const bootstrap =
        uri === 'solvapay://bootstrap.json'
          ? JSON.stringify({
              productRef: isRecord(params.config) ? params.config.productRef : undefined,
              returnUrl: isRecord(params.config) ? params.config.publicBaseUrl : undefined,
            })
          : '{}'
      return {
        kind: 'rpc',
        rpc: {
          jsonrpc: '2.0',
          id: handled.rpcId ?? null,
          result: {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: bootstrap,
              },
            ],
          },
        },
      }
    }
    return handled
  }
}

type RegisteredToolLike = {
  enabled?: boolean
  title?: string
  description?: string
  annotations?: unknown
  icons?: unknown
  _meta?: unknown
  handler?: (args: unknown, extra: unknown) => Promise<unknown>
  executor?: (args: unknown, extra: unknown) => Promise<unknown>
}

function registeredTools(server: McpServer): Record<string, RegisteredToolLike> {
  return ((server as unknown as { _registeredTools?: Record<string, RegisteredToolLike> })
    ._registeredTools ?? {})
}

function stampWidgetResultMeta(raw: unknown, resourceUri: string | undefined): unknown {
  if (!resourceUri || !isRecord(raw)) return raw
  const meta = isRecord(raw._meta) ? { ...raw._meta } : {}
  const ui = isRecord(meta.ui) ? { ...meta.ui } : {}
  if (typeof ui.resourceUri !== 'string') {
    ui.resourceUri = resourceUri
  }
  meta.ui = ui
  if (meta['ui/resourceUri'] === undefined) {
    meta['ui/resourceUri'] = resourceUri
  }
  return { ...raw, _meta: meta }
}

export function installEngineHandlers(
  server: McpServer,
  options: {
    solvaPay: BuildSolvaPayDescriptorsOptions['solvaPay']
    config: Omit<McpEngineConfig, 'payableTools' | 'userAgent'>
    payables: Map<string, McpEnginePayable>
    readHtml?: () => Promise<string>
    registerPrompts?: boolean
    registerDocsResources?: boolean
    resourceCsp?: unknown
    onDispatch?: (rpc: unknown) => void
    onDispatched?: (result: { body: unknown }, durationMs: number) => void
    requestUserAgent?: string
  },
): void {
  const inner = (
    server as unknown as {
      server: {
        removeRequestHandler?: (method: string) => void
        setRequestHandler: (
          method: string,
          handler: (req: unknown, extra: unknown) => Promise<unknown>,
        ) => void
        registerCapabilities?: (caps: Record<string, unknown>) => void
      }
    }
  ).server
  inner.registerCapabilities?.({ tools: {}, resources: {}, prompts: {} })
  const mcpDispatch = resolveMcpDispatch(options.solvaPay)

  const run = async (method: string, request: unknown, extra: unknown): Promise<unknown> => {
    const req = isRecord(request) ? request : {}
    const params = 'params' in req ? req.params : {}
    const rpc = {
      jsonrpc: '2.0',
      id: req.id ?? 1,
      method,
      params: params ?? {},
    }
    const payableTools = [...options.payables.keys()].sort()
    const result = await runMcpEngineRequest({
      mcpDispatch,
      rpc,
      config: {
        ...options.config,
        payableTools,
        ...(userAgentFromExtra(extra, server, options.requestUserAgent) !== undefined
          ? { userAgent: userAgentFromExtra(extra, server, options.requestUserAgent) }
          : {}),
      },
      ...(authHeaderFromExtra(extra) !== undefined
        ? { authHeader: authHeaderFromExtra(extra) }
        : {}),
      payables: options.payables,
      ...(options.onDispatch !== undefined ? { onDispatch: options.onDispatch } : {}),
      ...(options.onDispatched !== undefined ? { onDispatched: options.onDispatched } : {}),
    })
    return jsonRpcResult(result.body)
  }

  const setHandler = (
    method: string,
    handler: (req: unknown, extra: unknown) => Promise<unknown>,
  ): void => {
    inner.removeRequestHandler?.(method)
    inner.setRequestHandler(method, handler)
  }

  setHandler('tools/list', async (request, extra) => {
    const listed = await run('tools/list', request, extra)
    const tools = isRecord(listed) && Array.isArray(listed.tools) ? [...listed.tools] : []
    const names = new Set(
      tools
        .map(tool => (isRecord(tool) && typeof tool.name === 'string' ? tool.name : ''))
        .filter(name => name.length > 0),
    )
    const bundle = mcpDescriptors({
      resourceUri: options.config.resourceUri,
      publicBaseUrl: options.config.publicBaseUrl,
      productRef: options.config.productRef,
      ...(options.config.views !== undefined
        ? { views: options.config.views as Parameters<typeof mcpDescriptors>[0]['views'] }
        : {}),
      ...(options.config.csp !== undefined
        ? { csp: options.config.csp as Parameters<typeof mcpDescriptors>[0]['csp'] }
        : {}),
      ...(options.config.apiBaseUrl !== undefined ? { apiBaseUrl: options.config.apiBaseUrl } : {}),
      ...(options.config.branding !== undefined ? { branding: options.config.branding } : {}),
    })
    const byName = new Map(bundle.tools.map(tool => [tool.name, tool]))
    const projected = tools.map(tool => {
      if (!isRecord(tool) || typeof tool.name !== 'string') return tool
      const descriptor = byName.get(tool.name)
      if (descriptor === undefined) return tool
      const meta: Record<string, unknown> = { ...descriptor.meta }
      const ui = isRecord(meta.ui) ? { ...meta.ui } : {}
      if (typeof ui.resourceUri === 'string' && meta['ui/resourceUri'] === undefined) {
        meta['ui/resourceUri'] = ui.resourceUri
      }
      if (descriptor.icons !== undefined && ui.icons === undefined) {
        ui.icons = descriptor.icons
      }
      if (Object.keys(ui).length > 0) meta.ui = ui
      return {
        ...tool,
        ...(descriptor.title !== undefined ? { title: descriptor.title } : {}),
        description: descriptor.description,
        inputSchema: descriptor.inputSchema,
        annotations: descriptor.annotations,
        _meta: meta,
        ...(descriptor.icons !== undefined ? { icons: descriptor.icons } : {}),
      }
    })
    for (const [name, tool] of Object.entries(registeredTools(server))) {
      if (tool.enabled === false || names.has(name)) continue
      projected.push({
        name,
        ...(tool.title !== undefined ? { title: tool.title } : {}),
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
        ...(tool.icons !== undefined ? { icons: tool.icons } : {}),
        ...(tool._meta !== undefined ? { _meta: tool._meta } : {}),
      })
    }
    const hideAudiences = options.config.hideAudiences
    const listedTools =
      hideAudiences !== undefined && hideAudiences.length > 0
        ? hideToolsByAudience(
            projected,
            hideAudiences,
            userAgentFromExtra(extra, server, options.requestUserAgent),
          ).tools
        : projected
    return { ...(isRecord(listed) ? listed : {}), tools: listedTools }
  })

  setHandler('tools/call', async (request, extra) => {
    const req = isRecord(request) ? request : {}
    const params = isRecord(req.params) ? req.params : {}
    const name = typeof params.name === 'string' ? params.name : ''
    const local = registeredTools(server)[name]
    if (local !== undefined && local.enabled !== false) {
      const args = params.arguments ?? {}
      const invoke = local.executor ?? local.handler
      if (invoke !== undefined) {
        return (await invoke(args, extra)) as CallToolResult
      }
    }
    const raw = await run('tools/call', request, extra)
    return stampWidgetResultMeta(raw, options.config.resourceUri)
  })

  setHandler('resources/list', async (request, extra) => {
    const listed = await run('resources/list', request, extra)
    if (!isRecord(listed) || !Array.isArray(listed.resources)) return listed
    const bundle = mcpDescriptors({
      resourceUri: options.config.resourceUri,
      publicBaseUrl: options.config.publicBaseUrl,
      productRef: options.config.productRef,
      ...(options.config.apiBaseUrl !== undefined ? { apiBaseUrl: options.config.apiBaseUrl } : {}),
      ...(options.config.csp !== undefined
        ? { csp: options.config.csp as Parameters<typeof mcpDescriptors>[0]['csp'] }
        : {}),
    })
    const uiMeta = {
      ui: {
        csp: bundle.csp,
        prefersBorder: false,
      },
    }
    const resources = listed.resources.map(item => {
      if (!isRecord(item) || item.uri !== options.config.resourceUri) return item
      return { ...item, _meta: uiMeta }
    })
    if (options.registerDocsResources === false) {
      return {
        ...listed,
        resources: resources.filter(
          item => !(isRecord(item) && item.uri === 'docs://solvapay/overview.md'),
        ),
      }
    }
    return { ...listed, resources }
  })
  setHandler('resources/read', async (request, extra) => {
    const req = isRecord(request) ? request : {}
    const params = isRecord(req.params) ? req.params : {}
    const uri = typeof params.uri === 'string' ? params.uri : ''
    if (uri === options.config.resourceUri && options.readHtml !== undefined) {
      const text = await options.readHtml()
      return {
        contents: [
          {
            uri,
            mimeType: RESOURCE_MIME_TYPE,
            text,
            _meta: {
              ui: {
                ...(options.resourceCsp !== undefined ? { csp: options.resourceCsp } : {}),
                prefersBorder: false,
              },
            },
          },
        ],
      }
    }
    return run('resources/read', request, extra)
  })
  setHandler('prompts/list', async (request, extra) => {
    if (options.registerPrompts === false) return { prompts: [] }
    return run('prompts/list', request, extra)
  })
  setHandler('prompts/get', (request, extra) => {
    if (options.registerPrompts === false) {
      throw new Error('prompts are not registered')
    }
    return run('prompts/get', request, extra)
  })
}

export function buildSolvaPayMcpServer(
  options: BuildSolvaPayMcpServerOptions,
): BuiltSolvaPayMcpServer {
  const {
    serverName,
    serverVersion = '1.0.0',
    ...descriptorOptions
  } = options

  const descriptors = buildSolvaPayDescriptors({
    ...descriptorOptions,
    readHtml:
      descriptorOptions.readHtml ??
      (descriptorOptions.htmlPath ? undefined : defaultMcpAppHtml),
  })

  const effectiveServerName =
    serverName ?? descriptorOptions.branding?.brandName ?? 'solvapay-mcp-server'
  const serverIcons = deriveIcons(descriptorOptions.branding)

  const server = new McpServer({
    name: effectiveServerName,
    version: serverVersion,
    ...(serverIcons ? { icons: serverIcons } : {}),
  })

  const payables = new Map<string, McpEnginePayable>()

  const resource = descriptors.resource
  registerAppResource(
    server,
    resource.uri,
    resource.uri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          csp: resource.csp,
          prefersBorder: false,
        },
      },
    },
    async (): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: resource.uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await resource.readHtml(),
          _meta: {
            ui: {
              csp: resource.csp,
              prefersBorder: false,
            },
          },
        },
      ],
    }),
  )

  return { server, descriptors, payables }
}
