/**
 * `createSolvaPayMcpFetch` — descriptor-accepting unified factory for
 * Web-standards runtimes.
 */

import type { BuildSolvaPayDescriptorsOptions } from '@solvapay/mcp-core'
import { buildPayableHandler } from '@solvapay/mcp-core'
import type { McpEnginePayable } from '@solvapay/mcp-core'
import {
  buildSolvaPayMcpServer,
  hideAudiencesFromConfig,
  installEngineHandlers,
  userAgentFromRequestInfo,
  type HideToolsByAudienceConfig,
} from '../internal/buildMcpServer'
import { z } from 'zod'
import {
  payableToolAnnotations,
  registerPayableTool,
  wrapInputSchema,
  type RegisterPayableToolOptions,
} from '../registerPayableTool'
import type { AdditionalToolsContext } from '../server'
import {
  createSolvaPayMcpFetchHandler,
  type CreateSolvaPayMcpFetchHandlerOptions,
  type McpRequestContext,
} from './handler'
import type { McpOauthRequestClient } from '../internal/mcp-oauth-request'
import type { McpResolveAuthClient } from '../internal/mcp-resolve-auth'
import { defaultMcpAppHtml } from '#mcp-app-html'

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

function bindEnginePayables(
  payables: Map<string, McpEnginePayable>,
  solvaPay: AdditionalToolsContext['solvaPay'],
  productRef: string,
  additionalTools: ((ctx: AdditionalToolsContext) => void) | undefined,
): void {
  if (!additionalTools) return
  additionalTools({
    server: {
      registerTool: () => ({}) as never,
    } as unknown as AdditionalToolsContext['server'],
    solvaPay,
    resourceUri: '',
    productRef,
    registerPayable: (name, opts) => {
      const product = opts.product ?? productRef
      const protectedHandler = buildPayableHandler(
        solvaPay,
        {
          product,
          getCustomerRef: opts.getCustomerRef,
          usageType: opts.usageType,
        },
        opts.handler as never,
      )
      const wrappedSchema = wrapInputSchema(opts.schema)
      payables.set(name, {
        invoke: (args, customerRef) =>
          protectedHandler(
            args,
            customerRef ? { authInfo: { extra: { customer_ref: customerRef } } } : undefined,
          ),
        ...(opts.title !== undefined ? { title: opts.title } : {}),
        ...(opts.description !== undefined ? { description: opts.description } : {}),
        ...(wrappedSchema !== undefined ? { inputSchema: z.toJSONSchema(wrappedSchema) } : {}),
        annotations: payableToolAnnotations(opts.annotations),
      })
    },
  })
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
    payables: Map<string, McpEnginePayable>
    hs256Secret?: string
  },
) {
  const { descriptorOptions, additionalTools, hideToolsByAudience, payables, hs256Secret } = options

  const { server, descriptors } = buildSolvaPayMcpServer(descriptorOptions)

  if (additionalTools) {
    const { solvaPay, productRef, resourceUri } = descriptorOptions
    const registerPayable: AdditionalToolsContext['registerPayable'] = (name, opts) => {
      registerPayableTool(server, name, {
        solvaPay,
        ...opts,
        product: opts.product ?? productRef,
      } as RegisterPayableToolOptions)
    }
    additionalTools({ server, solvaPay, resourceUri, productRef, registerPayable })
  }

  const hideAudiences = hideAudiencesFromConfig(hideToolsByAudience)
  const requestUserAgent = userAgentFromRequestInfo(ctx.requestInfo)
  installEngineHandlers(server, {
    solvaPay: descriptorOptions.solvaPay,
    config: {
      productRef: descriptorOptions.productRef,
      publicBaseUrl: descriptorOptions.publicBaseUrl,
      resourceUri: descriptorOptions.resourceUri,
      ...(descriptorOptions.views !== undefined ? { views: [...descriptorOptions.views] } : {}),
      ...(descriptorOptions.csp !== undefined ? { csp: descriptorOptions.csp } : {}),
      ...(descriptorOptions.apiBaseUrl !== undefined
        ? { apiBaseUrl: descriptorOptions.apiBaseUrl }
        : {}),
      ...(descriptorOptions.branding !== undefined ? { branding: descriptorOptions.branding } : {}),
      ...(hideAudiences !== undefined ? { hideAudiences } : {}),
      ...(hs256Secret !== undefined ? { hs256Secret } : {}),
    },
    payables,
    readHtml: descriptors.resource.readHtml,
    resourceCsp: descriptors.resource.csp,
    registerPrompts: descriptorOptions.registerPrompts,
    registerDocsResources: descriptorOptions.registerDocsResources,
    ...(requestUserAgent !== undefined ? { requestUserAgent } : {}),
  })

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
  const nativeOauth = isNativeOauthClient(solvaPay.apiClient) ? solvaPay.apiClient : undefined
  const payables = new Map<string, McpEnginePayable>()
  const mcpDispatch =
    typeof solvaPay.apiClient.mcpDispatch === 'function'
      ? solvaPay.apiClient.mcpDispatch.bind(solvaPay.apiClient)
      : undefined
  if (mcpDispatch !== undefined) {
    bindEnginePayables(payables, solvaPay, productRef, additionalTools)
  }
  const hideAudiences = hideAudiencesFromConfig(hideToolsByAudience)

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
        payables,
        ...(additionalTools !== undefined ? { additionalTools } : {}),
        ...(hideToolsByAudience !== undefined ? { hideToolsByAudience } : {}),
        ...(handlerRest.hs256Secret !== undefined ? { hs256Secret: handlerRest.hs256Secret } : {}),
      }),
    publicBaseUrl,
    productRef,
    responseMode: handlerRest.responseMode ?? 'json',
    ...handlerRest,
    ...(handlerRest.oauthClient === undefined && nativeOauth !== undefined
      ? { oauthClient: nativeOauth }
      : {}),
    ...(mcpDispatch !== undefined
      ? {
          engine: {
            mcpDispatch,
            config: {
              productRef,
              publicBaseUrl,
              resourceUri: resourceUri ?? 'ui://widget.html',
              ...(apiBaseUrl !== undefined ? { apiBaseUrl } : {}),
              ...(views !== undefined ? { views: [...views] } : {}),
              ...(csp !== undefined ? { csp } : {}),
              ...(branding !== undefined ? { branding } : {}),
              ...(hideAudiences !== undefined ? { hideAudiences } : {}),
              ...(handlerRest.hs256Secret !== undefined
                ? { hs256Secret: handlerRest.hs256Secret }
                : {}),
            },
            payables,
            ...(onToolCall !== undefined
              ? {
                  onDispatch: (rpc: unknown) => {
                    onToolCall('*', rpc, undefined)
                  },
                }
              : {}),
            readHtml: readHtml ?? defaultMcpAppHtml,
            ...(onToolResult !== undefined
              ? {
                  onDispatched: (result: { body: unknown }, durationMs: number) => {
                    onToolResult(
                      '*',
                      {
                        content: [
                          {
                            type: 'text',
                            text:
                              typeof result.body === 'string'
                                ? result.body
                                : JSON.stringify(result.body ?? null),
                          },
                        ],
                      },
                      { durationMs },
                    )
                  },
                }
              : {}),
          },
        }
      : {}),
  })
}

function isNativeOauthClient(
  value: unknown,
): value is McpOauthRequestClient & McpResolveAuthClient {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as McpOauthRequestClient).mcpOauthRequest === 'function' &&
    typeof (value as McpResolveAuthClient).mcpResolveAuth === 'function'
  )
}
