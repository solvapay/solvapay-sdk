/**
 * `createSolvaPayMcpServer` — batteries-included factory that
 * registers the full SolvaPay transport + bootstrap tool surface on a
 * fresh `McpServer` from the official `@modelcontextprotocol/sdk`,
 * plus the UI resource the `open_*` tools reference.
 *
 * Internals delegate to `internal/buildMcpServer` (shared with the
 * `./fetch` subpath entry) so the two factories register the same 11
 * tools in the same order off the same `buildSolvaPayDescriptors`
 * bundle without duplicating the registration loop.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { BuildSolvaPayDescriptorsOptions } from '@solvapay/mcp-core'
import type { SolvaPay } from '@solvapay/server'
import {
  applyHideToolsByAudience,
  buildSolvaPayMcpServer,
  normaliseHideToolsByAudience,
  type HideToolsByAudienceConfig,
} from './internal/buildMcpServer'

export type { HideToolsByAudienceConfig } from './internal/buildMcpServer'
import { registerPayableTool, type RegisterPayableToolOptions } from './registerPayableTool'

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
  registerPayable: <
    InputSchema extends ZodRawShapeCompat | AnySchema | undefined = undefined,
    TData = unknown,
  >(
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
   * After registration, wrap the `tools/list` handler to drop any
   * tool whose `_meta.audience` matches one of these values. The
   * tools stay `enabled: true` so `tools/call` still reaches their
   * handlers — this option only affects the `tools/list` response
   * shape. Pass `['ui']` to keep the LLM-facing catalogue narrow to
   * the four intent tools (`upgrade` / `manage_account` /
   * `activate_plan` / `topup`) plus your own merchant-registered
   * data tools, while leaving the seven UI transport tools
   * (`create_payment_intent`, etc.) callable for the SolvaPay
   * iframe.
   *
   * # ChatGPT auto-bypass
   *
   * ChatGPT's Custom Connector gateway re-validates iframe-initiated
   * `tools/call` against the cached `tools/list` catalog, so any
   * tool hidden by this option becomes uncallable from the embedded
   * iframe and surfaces in the UI as `MCP error -32000: MCP Resource
   * not found`. To preserve the cleaner LLM catalog on every other
   * host while keeping the iframe working on ChatGPT, the SDK
   * auto-detects ChatGPT-originated `tools/list` requests (matching
   * `request.headers['user-agent']` and the post-`initialize`
   * `clientInfo.name` against `/openai-mcp/i`) and returns the full
   * catalog to them. The detection is verified live against
   * `openai-mcp/1.0.0 (ChatGPT)` and the broad pattern survives a UA
   * version bump.
   *
   * To extend the bypass to a future iframe-capable host, pass the
   * object form: `{ audiences: ['ui'], bypassWhen: ctx => … }`.
   *
   * To disable the bypass and apply the filter unconditionally
   * (e.g. on a known text-only deployment), pass `{ audiences:
   * ['ui'], bypassWhen: () => false }`.
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

  const { server, descriptors } = buildSolvaPayMcpServer({
    ...descriptorOptions,
    registerPrompts,
    registerDocsResources,
    ...(serverName !== undefined ? { serverName } : {}),
    serverVersion,
  })

  if (additionalTools) {
    const { solvaPay, productRef, resourceUri } = descriptorOptions
    const registerPayable: AdditionalToolsContext['registerPayable'] = (name, opts) => {
      // Spread `opts` *first* so an explicit `undefined` on
      // `opts.product` / `opts.buildBootstrap` (shape allows it via
      // `?:`) can't overwrite the defaults set below. `resourceUri` is
      // no longer forwarded: merchant payable tools use text-only
      // paywall / nudge responses per the SEP-1865 refactor.
      registerPayableTool(server, name, {
        solvaPay,
        ...opts,
        product: opts.product ?? productRef,
        buildBootstrap: opts.buildBootstrap ?? descriptors.buildBootstrapPayload,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    }
    additionalTools({ server, solvaPay, resourceUri, productRef, registerPayable })
  }

  // Apply the tools/list audience filter last so it sees every tool
  // registered by the descriptor loop + `additionalTools` hook.
  const { audiences, options: filterOptions } = normaliseHideToolsByAudience(hideToolsByAudience)
  applyHideToolsByAudience(server, audiences, filterOptions)

  return server
}
