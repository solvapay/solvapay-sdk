/**
 * `createSolvaPayMcpFetch` — descriptor-accepting unified factory for
 * Web-standards runtimes. Collapses the two-package dance (build
 * `McpServer` in `@solvapay/mcp`, wrap in `createSolvaPayMcpFetchHandler`)
 * into a single call so edge consumers (Supabase Edge, Cloudflare
 * Workers, Vercel Edge, Deno, Bun) can import ONLY from
 * `@solvapay/mcp-fetch` — matching the parallel-adapters design
 * stated in `@solvapay/mcp-core`'s module-level comment.
 *
 * The body is a near-straight copy of `createSolvaPayMcpServer`'s
 * registration loop from `@solvapay/mcp/src/server.ts`. We accept the
 * ~80-line overlap rather than extracting a shared helper because:
 *
 *   - `@solvapay/mcp-core` has no runtime dep on
 *     `@modelcontextprotocol/sdk` / `@modelcontextprotocol/ext-apps`
 *     (that's the whole point of `mcp-core` — framework-neutral
 *     contracts). Adding one just to host the shared loop would
 *     invert the dependency graph.
 *   - `@solvapay/mcp-fetch` can't depend on `@solvapay/mcp` without
 *     turning the parallel-adapter design into stacked layers (the
 *     exact smell this factory was introduced to fix).
 *
 * The duplication is stable: both copies register the same 11 tools
 * in the same order off the same `buildSolvaPayDescriptors` bundle,
 * so the diff-risk is limited to the few lines that wire the
 * descriptor into `registerAppTool` / `server.registerPrompt` /
 * `server.registerResource` / `registerAppResource`.
 *
 * Callers who bring their own `McpServer` (custom tool surface, third-
 * party toolbox) keep using `createSolvaPayMcpFetchHandler({ server,
 * ... })` unchanged.
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import {
  applyHideToolsByAudience,
  buildSolvaPayDescriptors,
  deriveIcons,
  type BuildSolvaPayDescriptorsOptions,
  type SolvaPayDocsResourceDescriptor,
  type SolvaPayPromptDescriptor,
  type SolvaPayToolDescriptor,
} from '@solvapay/mcp-core'
import type { SolvaPay } from '@solvapay/server'
import {
  createSolvaPayMcpFetchHandler,
  type CreateSolvaPayMcpFetchHandlerOptions,
} from './handler'

/**
 * Callback fired from the `additionalTools` hook with the
 * freshly-constructed `McpServer` + helpers bound for the current
 * `solvaPay` instance.
 *
 * Mirrors the `AdditionalToolsContext` in `@solvapay/mcp` — kept
 * structurally identical so merchants can move the same callback
 * between `createSolvaPayMcpServer` and `createSolvaPayMcpFetch`
 * without code changes.
 *
 * Note: `registerPayable` lives on `@solvapay/mcp` (the
 * `registerPayableTool` helper there pulls in zod-compat + payable
 * handler wiring). Edge consumers who need paywalled data tools can
 * call `registerPayableTool` directly by importing it from
 * `@solvapay/mcp` — this factory deliberately leaves that binding
 * off the context to preserve the "import only @solvapay/mcp-fetch"
 * architectural guarantee. Adding the binding would drag every edge
 * caller into the `@solvapay/mcp` install graph.
 */
export interface AdditionalToolsContext {
  server: McpServer
  solvaPay: SolvaPay
  resourceUri: string
  productRef: string
}

export interface CreateSolvaPayMcpFetchOptions
  extends BuildSolvaPayDescriptorsOptions,
    Omit<CreateSolvaPayMcpFetchHandlerOptions, 'server'> {
  /**
   * Register non-SolvaPay tools on the freshly-built server. Receives
   * `{ server, solvaPay, resourceUri, productRef }` — use the raw
   * `server.registerTool(...)` or the `registerPayableTool` helper
   * exported from `@solvapay/mcp` (optional install) to wire merchant
   * surfaces.
   */
  additionalTools?: (ctx: AdditionalToolsContext) => void
  /**
   * Hide tools whose `_meta.audience` matches one of these values from
   * `tools/list`. See `@solvapay/mcp` `CreateSolvaPayMcpServerOptions`
   * for the full rationale.
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

// ---- Registration helpers (mirrors @solvapay/mcp/server.ts) ----
//
// Keep these in lockstep with the corresponding helpers in
// `packages/mcp/src/server.ts`. The diff-risk is bounded to the
// branding/icon merge + the `as any` casts the SDK types require.

function registerDescriptor(server: McpServer, tool: SolvaPayToolDescriptor): void {
  const baseMeta = (tool.meta as Record<string, unknown> | undefined) ?? {}
  const baseUi = (baseMeta.ui as Record<string, unknown> | undefined) ?? {}
  const metaWithIcons =
    tool.icons && tool.icons.length > 0
      ? { ...baseMeta, ui: { ...baseUi, icons: tool.icons } }
      : baseMeta

  registerAppTool(
    server,
    tool.name,
    {
      ...(tool.title !== undefined ? { title: tool.title } : {}),
      description: tool.description,
      inputSchema: tool.inputSchema,
      _meta: metaWithIcons,
      ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
      ...(tool.icons !== undefined ? { icons: tool.icons } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    async (args: Record<string, unknown>, extra?: unknown): Promise<CallToolResult> =>
      (await tool.handler(
        args,
        extra as Parameters<typeof tool.handler>[1],
      )) as unknown as CallToolResult,
  )
}

function registerPromptDescriptor(server: McpServer, prompt: SolvaPayPromptDescriptor): void {
  const config: {
    title?: string
    description?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    argsSchema?: any
  } = { description: prompt.description }
  if (prompt.title !== undefined) config.title = prompt.title
  if (prompt.argsSchema !== undefined) config.argsSchema = prompt.argsSchema

  server.registerPrompt(
    prompt.name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args: any) => (await prompt.handler(args ?? {})) as any,
  )
}

function registerDocsResource(server: McpServer, docs: SolvaPayDocsResourceDescriptor): void {
  server.registerResource(
    docs.name,
    docs.uri,
    {
      ...(docs.title !== undefined ? { title: docs.title } : {}),
      description: docs.description,
      mimeType: docs.mimeType,
    },
    async (): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: docs.uri,
          mimeType: docs.mimeType,
          text: await docs.readBody(),
        },
      ],
    }),
  )
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

  const descriptorOptions: BuildSolvaPayDescriptorsOptions = {
    solvaPay,
    productRef,
    resourceUri,
    ...(htmlPath !== undefined ? { htmlPath } : {}),
    ...(readHtml !== undefined ? { readHtml } : {}),
    publicBaseUrl,
    ...(views !== undefined ? { views } : {}),
    ...(csp !== undefined ? { csp } : {}),
    ...(getCustomerRef !== undefined ? { getCustomerRef } : {}),
    ...(onToolCall !== undefined ? { onToolCall } : {}),
    ...(onToolResult !== undefined ? { onToolResult } : {}),
    ...(branding !== undefined ? { branding } : {}),
  }

  const { tools, resource, prompts, docsResources } =
    buildSolvaPayDescriptors(descriptorOptions)

  const effectiveServerName = serverName ?? branding?.brandName ?? 'solvapay-mcp-server'
  const serverIcons = deriveIcons(branding)

  const server = new McpServer({
    name: effectiveServerName,
    version: serverVersion,
    ...(serverIcons ? { icons: serverIcons } : {}),
  })

  for (const tool of tools) {
    registerDescriptor(server, tool)
  }

  if (registerPrompts) {
    for (const prompt of prompts) {
      registerPromptDescriptor(server, prompt)
    }
  }

  if (registerDocsResources) {
    for (const docs of docsResources) {
      registerDocsResource(server, docs)
    }
  }

  registerAppResource(
    server,
    resource.uri,
    resource.uri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          csp: resource.csp,
          // See @solvapay/mcp/server.ts for the `prefersBorder: false`
          // rationale — widget paints its own card, host-painted
          // outer border produces a nested-container look.
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

  if (additionalTools) {
    additionalTools({ server, solvaPay, resourceUri, productRef })
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
