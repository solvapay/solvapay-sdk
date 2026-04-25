/**
 * `createSolvaPayMcpServer` — batteries-included factory that
 * registers the full SolvaPay transport + bootstrap tool surface on a
 * fresh `McpServer` from the official `@modelcontextprotocol/sdk`,
 * plus the UI resource the `open_*` tools reference.
 *
 * Internals are a thin mapper over `buildSolvaPayDescriptors` from
 * `@solvapay/mcp-core` — this package is the only one importing
 * `@modelcontextprotocol/*`.
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  AnySchema,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import {
  buildSolvaPayDescriptors,
  type BuildSolvaPayDescriptorsOptions,
  type SolvaPayDocsResourceDescriptor,
  type SolvaPayPromptDescriptor,
  type SolvaPayToolDescriptor,
} from '@solvapay/mcp-core'
import type { SolvaPay } from '@solvapay/server'
import {
  registerPayableTool,
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
}

function registerDescriptor(server: McpServer, tool: SolvaPayToolDescriptor): void {
  // Merge brand icons into `_meta.ui.icons` so ext-apps-aware hosts
  // can discover them alongside the UI resource URI. Newer MCP SDKs
  // may also surface `icons` as a top-level Tool field — we include
  // them on the config root as well so forward-compatible hosts pick
  // them up without a server change.
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
    // `SolvaPayCallToolResult` is a structural subset of the official
    // SDK's `CallToolResult`; cast to erase the extra-narrow `resource`
    // block typing the SDK expects on `{ type: 'resource' }` content.
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
    // Cast through `any` — the framework-neutral `argsSchema` is a
    // `Record<string, ZodTypeAny>` and the SDK expects a compatible
    // raw shape. The SDK's types disagree at the generic level, but
    // the runtime shape is identical.
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
 * Build the MCP server and register the full SolvaPay tool surface.
 */
export function createSolvaPayMcpServer(options: CreateSolvaPayMcpServerOptions): McpServer {
  const {
    additionalTools,
    registerPrompts = true,
    registerDocsResources = true,
    serverName,
    serverVersion = '1.0.0',
    ...descriptorOptions
  } = options

  const { tools, resource, prompts, docsResources, buildBootstrapPayload } =
    buildSolvaPayDescriptors(descriptorOptions)

  // Prefer the merchant's brand name for `Implementation.name` — MCP
  // hosts render it in the chrome strip next to the tool name, so
  // surfacing the merchant there (instead of a generic SolvaPay
  // string) is what removes the "double-branding" inside the iframe.
  // Explicit `serverName` still wins when the integrator needs a
  // stable protocol identifier distinct from the brand.
  const effectiveServerName =
    serverName ?? descriptorOptions.branding?.brandName ?? 'solvapay-mcp-server'

  const server = new McpServer({ name: effectiveServerName, version: serverVersion })

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
          prefersBorder: true,
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
              prefersBorder: true,
            },
          },
        },
      ],
    }),
  )

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
        buildBootstrap: opts.buildBootstrap ?? buildBootstrapPayload,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    }
    additionalTools({ server, solvaPay, resourceUri, productRef, registerPayable })
  }

  return server
}
