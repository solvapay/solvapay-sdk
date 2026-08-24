/**
 * `createSolvaPayMcpFetch` — descriptor-accepting unified factory for
 * Web-standards runtimes.
 */

import type { BuildSolvaPayDescriptorsOptions } from '@solvapay/mcp-core'
import { defaultIsChatGptRequest } from '@solvapay/mcp-core'
import {
  applyHideToolsByAudience,
  buildSolvaPayMcpServer,
  normaliseHideToolsByAudience,
  type HideToolsByAudienceConfig,
} from '../internal/buildMcpServer'
import { registerPayableTool, type RegisterPayableToolOptions } from '../registerPayableTool'
import type { AdditionalToolsContext } from '../server'
import {
  createSolvaPayMcpFetchHandler,
  type CreateSolvaPayMcpFetchHandlerOptions,
  type McpRequestContext,
} from './handler'

export type { AdditionalToolsContext } from '../server'

export interface CreateSolvaPayMcpFetchOptions
  extends
    Omit<BuildSolvaPayDescriptorsOptions, 'apiBaseUrl'>,
    Omit<CreateSolvaPayMcpFetchHandlerOptions, 'factory'> {
  additionalTools?: (ctx: AdditionalToolsContext) => void
  hideToolsByAudience?: HideToolsByAudienceConfig
  registerPrompts?: boolean
  registerDocsResources?: boolean
  serverName?: string
  serverVersion?: string
}

function buildServerForRequest(
  ctx: McpRequestContext,
  options: {
    descriptorOptions: BuildSolvaPayDescriptorsOptions & {
      registerPrompts: boolean
      registerDocsResources: boolean
      serverName?: string
      serverVersion: string
    }
    additionalTools?: (ctx: AdditionalToolsContext) => void
    hideToolsByAudience?: HideToolsByAudienceConfig
    bypassWarned: Set<string>
  },
) {
  const { descriptorOptions, additionalTools, hideToolsByAudience, bypassWarned } = options

  const { server, descriptors } = buildSolvaPayMcpServer(descriptorOptions)

  if (additionalTools) {
    const { solvaPay, productRef, resourceUri } = descriptorOptions
    const registerPayable: AdditionalToolsContext['registerPayable'] = (name, opts) => {
      registerPayableTool(server, name, {
        solvaPay,
        ...opts,
        product: opts.product ?? productRef,
        buildBootstrap: opts.buildBootstrap ?? descriptors.buildBootstrapPayload,
      } as RegisterPayableToolOptions)
    }
    additionalTools({ server, solvaPay, resourceUri, productRef, registerPayable })
  }

  const { audiences, options: filterOptions } = normaliseHideToolsByAudience(hideToolsByAudience)
  if (audiences && audiences.length > 0) {
    const bypass = (filterOptions.bypassWhen ?? defaultIsChatGptRequest)({
      server,
      extra: ctx.requestInfo ? { requestInfo: ctx.requestInfo } : undefined,
    })
    if (bypass) {
      const ua = ctx.requestInfo?.headers.get('user-agent') ?? undefined
      const context = ua ? `ua=${ua}` : 'no user-agent'
      if (!bypassWarned.has(context)) {
        bypassWarned.add(context)
        console.warn(
          `[solvapay/mcp] hideToolsByAudience filter bypassed (${context}); returning full tools/list catalog.`,
        )
      }
    } else {
      applyHideToolsByAudience(server, audiences, filterOptions)
    }
  }

  return server
}

export function createSolvaPayMcpFetch(
  options: CreateSolvaPayMcpFetchOptions,
): (req: Request) => Promise<Response> {
  const {
    solvaPay,
    productRef,
    resourceUri,
    htmlPath,
    readHtml,
    publicBaseUrl,
    views,
    csp,
    getCustomerRef,
    onToolCall,
    onToolResult,
    branding,
    additionalTools,
    hideToolsByAudience,
    registerPrompts = true,
    registerDocsResources = true,
    serverName,
    serverVersion = '1.0.0',
    ...handlerRest
  } = options

  const apiBaseUrl = handlerRest.apiBaseUrl
  const bypassWarned = new Set<string>()

  const descriptorOptions = {
    solvaPay,
    productRef,
    resourceUri,
    ...(htmlPath !== undefined ? { htmlPath } : {}),
    ...(readHtml !== undefined ? { readHtml } : {}),
    publicBaseUrl,
    ...(views !== undefined ? { views } : {}),
    ...(csp !== undefined ? { csp } : {}),
    ...(apiBaseUrl !== undefined ? { apiBaseUrl } : {}),
    ...(getCustomerRef !== undefined ? { getCustomerRef } : {}),
    ...(onToolCall !== undefined ? { onToolCall } : {}),
    ...(onToolResult !== undefined ? { onToolResult } : {}),
    ...(branding !== undefined ? { branding } : {}),
    registerPrompts,
    registerDocsResources,
    ...(serverName !== undefined ? { serverName } : {}),
    serverVersion,
  }

  return createSolvaPayMcpFetchHandler({
    factory: ctx =>
      buildServerForRequest(ctx, {
        descriptorOptions,
        bypassWarned,
        ...(additionalTools !== undefined ? { additionalTools } : {}),
        ...(hideToolsByAudience !== undefined ? { hideToolsByAudience } : {}),
      }),
    publicBaseUrl,
    productRef,
    responseMode: handlerRest.responseMode ?? 'json',
    ...handlerRest,
  })
}
