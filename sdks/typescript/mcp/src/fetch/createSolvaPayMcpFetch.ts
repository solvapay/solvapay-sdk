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
  type HideToolsByAudienceConfig,
} from '../internal/buildMcpServer'
import { registerPayableTool, type RegisterPayableToolOptions } from '../registerPayableTool'
import type { AdditionalToolsContext } from '../server'
import {
  createSolvaPayMcpFetchHandler,
  type CreateSolvaPayMcpFetchHandlerOptions,
  type McpRequestContext,
} from './handler'
import type { McpOauthRequestClient } from '../internal/mcp-oauth-request'

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
    } as AdditionalToolsContext['server'],
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
        },
        opts.handler as never,
      )
      payables.set(name, {
        invoke: (args, customerRef) =>
          protectedHandler(
            args,
            customerRef
              ? { authInfo: { extra: { customer_ref: customerRef } } }
              : undefined,
          ),
      })
    },
  })
}

function buildServerForRequest(
  _ctx: McpRequestContext,
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
  },
) {
  const { descriptorOptions, additionalTools, hideToolsByAudience, payables } = options

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
    },
    payables,
    readHtml: descriptors.resource.readHtml,
    resourceCsp: descriptors.resource.csp,
    registerPrompts: descriptorOptions.registerPrompts,
    registerDocsResources: descriptorOptions.registerDocsResources,
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
  const nativeOauth = isOauthRequestClient(solvaPay.apiClient) ? solvaPay.apiClient : undefined
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
              ...(hideAudiences !== undefined ? { hideAudiences } : {}),
            },
            payables,
            ...(onToolCall !== undefined
              ? {
                  onDispatch: (rpc: unknown) => {
                    onToolCall('*', rpc, undefined)
                  },
                }
              : {}),
            ...(onToolResult !== undefined
              ? {
                  onDispatched: (
                    result: { body: unknown },
                    durationMs: number,
                  ) => {
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

function isOauthRequestClient(value: unknown): value is McpOauthRequestClient {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as McpOauthRequestClient).mcpOauthRequest === 'function'
  )
}
