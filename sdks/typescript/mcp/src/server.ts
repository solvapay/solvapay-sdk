/**
 * `createSolvaPayMcpServer` — batteries-included factory that
 * registers the full SolvaPay transport + bootstrap tool surface on a
 * fresh `McpServer` from the official `@modelcontextprotocol/server`,
 * plus the UI resource the `open_*` tools reference.
 *
 * Internals delegate to `internal/buildMcpServer` (shared with the
 * `./fetch` subpath entry) so the two factories register the same 12
 * tools in the same order off the same `buildSolvaPayDescriptors`
 * bundle without duplicating the registration loop.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import type { BuildSolvaPayDescriptorsOptions } from '@solvapay/mcp-core'
import type { SolvaPay } from '@solvapay/server'
import {
  buildSolvaPayMcpServer,
  hideAudiencesFromConfig,
  installEngineHandlers,
  type HideToolsByAudienceConfig,
} from './internal/buildMcpServer'

export type { HideToolsByAudienceConfig } from './internal/buildMcpServer'
import {
  registerPayableTool,
  type InputSchemaOption,
  type RegisterPayableToolOptions,
} from './registerPayableTool'

/**
 * Callback fired from the `additionalTools` hook with helpers bound for
 * the current server + `solvaPay` instance.
 */
export interface AdditionalToolsContext {
  server: McpServer
  solvaPay: SolvaPay
  resourceUri: string
  productRef: string
  /**
   * `registerPayableTool` bound with `solvaPay` + `resourceUri` already
   * provided, and `product` defaulting to the server's `productRef`.
   *
   * Zod `schema` flows through to the handler's `args` parameter so
   * merchants get inferred arg types without a second declaration.
   */
  registerPayable: <InputSchema extends InputSchemaOption = undefined, TData = unknown>(
    name: string,
    options: Omit<RegisterPayableToolOptions<InputSchema, TData>, 'solvaPay' | 'product'> & {
      product?: string
    },
  ) => void
}

export interface CreateSolvaPayMcpServerOptions extends BuildSolvaPayDescriptorsOptions {
  /**
   * Integrator hook to register non-SolvaPay tools. The callback receives
   * the built server plus a `registerPayable` helper bound for this
   * instance.
   */
  additionalTools?: (ctx: AdditionalToolsContext) => void
  /**
   * Register the slash-command prompts (`/upgrade`, `/manage_account`,
   * `/topup`, `/activate_plan`) built from the descriptor bundle.
   * Defaults to `true` — the prompts are additive and silently ignored
   * by hosts without prompt support.
   */
  registerPrompts?: boolean
  /**
   * Register the narrated `docs://solvapay/overview.md` resource so
   * agents can `resources/read` before trying a tool. Defaults to
   * `true` — pure narration, no side-effects.
   */
  registerDocsResources?: boolean
  /** Overrides the default `McpServer` name. */
  serverName?: string
  /** Overrides the default `McpServer` version. */
  serverVersion?: string
  /**
   * Hide tools whose `_meta.audience` matches one of these values
   * from `tools/list`, and reject `tools/call` for those tools with
   * JSON-RPC `-32601`. Pass `['ui']` to keep the LLM-facing
   * catalogue to the four intent tools (`upgrade` /
   * `manage_account` / `activate_plan` / `topup`) plus your own
   * merchant-registered data tools.
   *
   * Hidden tools are not invocable. A spoofable `User-Agent` (or
   * `clientInfo.name`) does not restore them. MCP Apps hosts that
   * need iframe-only transport tools should rely on SEP-1865
   * `_meta.ui.visibility: ["app"]` rather than listing those tools
   * to every client.
   */
  hideToolsByAudience?: HideToolsByAudienceConfig
}

/**
 * Build the MCP server and register the full SolvaPay tool surface.
 */
export function createSolvaPayMcpServer(options: CreateSolvaPayMcpServerOptions): McpServer {
  const {
    additionalTools,
    registerPrompts = true,
    registerDocsResources = true,
    serverName,
    serverVersion = '1.0.0',
    hideToolsByAudience,
    ...descriptorOptions
  } = options

  const { server, descriptors, payables } = buildSolvaPayMcpServer({
    ...descriptorOptions,
    registerPrompts,
    registerDocsResources,
    ...(serverName !== undefined ? { serverName } : {}),
    serverVersion,
  })

  if (additionalTools) {
    const { solvaPay, productRef, resourceUri } = descriptorOptions
    const registerPayable: AdditionalToolsContext['registerPayable'] = (name, opts) => {
      registerPayableTool(server, name, {
        solvaPay,
        ...opts,
        product: opts.product ?? productRef,
      })
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
    registerPrompts,
    registerDocsResources,
    ...(descriptorOptions.onToolCall !== undefined
      ? {
          onDispatch: (rpc: unknown) => {
            descriptorOptions.onToolCall?.('*', rpc, undefined)
          },
        }
      : {}),
    ...(descriptorOptions.onToolResult !== undefined
      ? {
          onDispatched: (result: { body: unknown }, durationMs: number) => {
            descriptorOptions.onToolResult?.(
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
  })

  return server
}
