/**
 * `createSolvaPayMcpFetch` — descriptor-accepting unified factory for
 * Web-standards runtimes.
 */

import type { BuildSolvaPayDescriptorsOptions } from '@solvapay/mcp-core'
import { defaultIsChatGptRequest } from '@solvapay/mcp-core'
import type { SolvaPay } from '@solvapay/server'
import {
  applyHideToolsByAudience,
  buildSolvaPayMcpServer,
  normaliseHideToolsByAudience,
  type HideToolsByAudienceConfig,
} from '../internal/buildMcpServer'
import { bindAdditionalTools, type AdditionalToolsContext } from '../server'
import {
  createSolvaPayMcpFetchHandler,
  type CreateSolvaPayMcpFetchHandlerOptions,
  type McpRequestContext,
  type VerifyBearerToken,
} from './handler'

export type { AdditionalToolsContext } from '../server'

/**
 * Resolve a verified external identity to a SolvaPay customer.
 *
 * Wraps a `verifyToken` hook so that, after a non-null result, a subject
 * that is not already a `cus_` reference is passed through
 * `solvaPay.ensureCustomer(subject, subject, …)` — which looks the
 * customer up by `externalRef` and creates one on first sight — and the
 * returned `VerifiedBearer` carries the resulting `customerRef`.
 *
 * `email` reaches `ensureCustomer` only when the issuer asserted
 * `emailVerified === true`. `ensureCustomer` links to an existing customer
 * by email on a conflict, so an unverified email would let anyone claim
 * another customer's account by registering their address.
 */
export function bridgeVerifiedBearerToCustomer(
  verifyToken: VerifyBearerToken,
  solvaPay: Pick<SolvaPay, 'ensureCustomer'>,
): VerifyBearerToken {
  return async (token, req) => {
    const verified = await verifyToken(token, req)
    if (!verified) return null
    if (verified.customerRef) return verified
    if (verified.subject.startsWith('cus_')) {
      return { ...verified, customerRef: verified.subject }
    }

    const customerRef = await solvaPay.ensureCustomer(verified.subject, verified.subject, {
      ...(verified.emailVerified === true && verified.email ? { email: verified.email } : {}),
      ...(verified.name ? { name: verified.name } : {}),
    })
    return { ...verified, customerRef }
  }
}

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
    bindAdditionalTools(
      server,
      {
        solvaPay,
        productRef,
        resourceUri,
        buildBootstrap: descriptors.buildBootstrapPayload,
      },
      additionalTools,
    )
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
    verifyToken,
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
    ...(verifyToken ? { verifyToken: bridgeVerifiedBearerToCustomer(verifyToken, solvaPay) } : {}),
  })
}
