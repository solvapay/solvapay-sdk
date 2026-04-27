/**
 * `createSolvaPayMcpFetch` — descriptor-accepting unified factory for
 * Web-standards runtimes. Collapses the two-step dance (build
 * `McpServer` via `createSolvaPayMcpServer`, wrap in
 * `createSolvaPayMcpFetchHandler`) into a single call so edge
 * consumers (Supabase Edge, Cloudflare Workers, Vercel Edge, Deno,
 * Bun) can import ONLY from `@solvapay/mcp/fetch`.
 *
 * The registration loop is shared with the root `.` entry via
 * `../internal/buildMcpServer`. `AdditionalToolsContext` is
 * re-exported from the root `@solvapay/mcp` entry so merchants can
 * move the same `additionalTools` callback between
 * `createSolvaPayMcpServer` and `createSolvaPayMcpFetch` without
 * touching the handler's signature — including the bound
 * `registerPayable` helper.
 */

import type { BuildSolvaPayDescriptorsOptions } from '@solvapay/mcp-core'
import { applyHideToolsByAudience, buildSolvaPayMcpServer } from '../internal/buildMcpServer'
import { registerPayableTool, type RegisterPayableToolOptions } from '../registerPayableTool'
import type { AdditionalToolsContext } from '../server'
import { createSolvaPayMcpFetchHandler, type CreateSolvaPayMcpFetchHandlerOptions } from './handler'

export type { AdditionalToolsContext } from '../server'

export interface CreateSolvaPayMcpFetchOptions
  extends
    Omit<BuildSolvaPayDescriptorsOptions, 'apiBaseUrl'>,
    Omit<CreateSolvaPayMcpFetchHandlerOptions, 'server'> {
  /**
   * Register non-SolvaPay tools on the freshly-built server. Receives
   * `{ server, solvaPay, resourceUri, productRef, registerPayable }`
   * — same shape as `createSolvaPayMcpServer`'s hook so merchant tool
   * callbacks are portable between the two factories.
   */
  additionalTools?: (ctx: AdditionalToolsContext) => void
  /**
   * Hide tools whose `_meta.audience` matches one of these values from
   * `tools/list`. See `CreateSolvaPayMcpServerOptions` for the full
   * rationale.
   */
  hideToolsByAudience?: string[]
  /**
   * Register the slash-command prompts built from the descriptor
   * bundle. Defaults to `true`.
   */
  registerPrompts?: boolean
  /**
   * Register the narrated `docs://solvapay/overview.md` resource so
   * agents can `resources/read` before trying a tool. Defaults to `true`.
   */
  registerDocsResources?: boolean
  /** Overrides the default `McpServer` name. */
  serverName?: string
  /** Overrides the default `McpServer` version. */
  serverVersion?: string
}

/**
 * Build a fetch-first MCP handler with the full SolvaPay tool surface
 * registered in-place. Returns a `(req: Request) => Promise<Response>`
 * suitable for `Deno.serve`, `addEventListener('fetch', …)`, Cloudflare
 * Workers' `fetch` export, or any other Web-standards runtime.
 */
export function createSolvaPayMcpFetch(
  options: CreateSolvaPayMcpFetchOptions,
): (req: Request) => Promise<Response> {
  const {
    // Descriptor options.
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
    // Server / registration options.
    additionalTools,
    hideToolsByAudience,
    registerPrompts = true,
    registerDocsResources = true,
    serverName,
    serverVersion = '1.0.0',
    // Handler options — everything in
    // `CreateSolvaPayMcpFetchHandlerOptions` except `server`.
    ...handlerRest
  } = options

  // `apiBaseUrl` lives on the handler-options extension (it's required
  // there for the OAuth proxy upstream), but we also forward it to the
  // descriptor builder so the CSP auto-includes the configured API
  // origin. Read from `handlerRest` without removing it — the handler
  // call below still needs its copy to build the OAuth router.
  const apiBaseUrl = handlerRest.apiBaseUrl

  const { server, descriptors } = buildSolvaPayMcpServer({
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
  })

  if (additionalTools) {
    // Mirror the root entry's `registerPayable` binding so merchant
    // callbacks are portable between `createSolvaPayMcpServer` and
    // this factory without code changes.
    const registerPayable: AdditionalToolsContext['registerPayable'] = (name, opts) => {
      registerPayableTool(server, name, {
        solvaPay,
        ...opts,
        product: opts.product ?? productRef,
        buildBootstrap: opts.buildBootstrap ?? descriptors.buildBootstrapPayload,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as unknown as RegisterPayableToolOptions<any, any>)
    }
    additionalTools({ server, solvaPay, resourceUri, productRef, registerPayable })
  }

  // Filter UI-audience tools from `tools/list` last so we see every
  // tool the descriptor loop + `additionalTools` registered.
  applyHideToolsByAudience(server, hideToolsByAudience)

  return createSolvaPayMcpFetchHandler({
    server,
    publicBaseUrl,
    productRef,
    ...handlerRest,
  })
}
