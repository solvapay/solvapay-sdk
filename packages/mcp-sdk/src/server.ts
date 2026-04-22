/**
 * `createSolvaPayMcpServer` — batteries-included factory that
 * registers the full SolvaPay transport + bootstrap tool surface on a
 * fresh `McpServer` from the official `@modelcontextprotocol/sdk`,
 * plus the UI resource the `open_*` tools reference.
 *
 * Internals are a thin mapper over `buildSolvaPayDescriptors` from
 * `@solvapay/mcp` — this package is the only one importing
 * `@modelcontextprotocol/*`.
 */

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import {
  buildSolvaPayDescriptors,
  type BuildSolvaPayDescriptorsOptions,
  type SolvaPayDocsResourceDescriptor,
  type SolvaPayPromptDescriptor,
  type SolvaPayToolDescriptor,
} from '@solvapay/mcp'
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
   */
  registerPayable: <InputSchema extends Parameters<typeof registerPayableTool>[2]['schema']>(
    name: string,
    options: Omit<
      RegisterPayableToolOptions<NonNullable<InputSchema>>,
      'solvaPay' | 'resourceUri' | 'product'
    > & {
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
   * Register the five slash-command prompts (`/upgrade`,
   * `/manage_account`, `/topup`, `/check_usage`, `/activate_plan`) built
   * from the descriptor bundle. Defaults to `true` — the prompts are
   * additive and silently ignored by hosts without prompt support.
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
  registerAppTool(
    server,
    tool.name,
    {
      ...(tool.title !== undefined ? { title: tool.title } : {}),
      description: tool.description,
      inputSchema: tool.inputSchema,
      _meta: tool.meta,
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
    serverName = 'solvapay-mcp-server',
    serverVersion = '1.0.0',
    ...descriptorOptions
  } = options

  const { tools, resource, prompts, docsResources, buildBootstrapPayload } =
    buildSolvaPayDescriptors(descriptorOptions)
  const server = new McpServer({ name: serverName, version: serverVersion })

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
      // `?:`) can't overwrite the defaults set below.
      registerPayableTool(server, name, {
        solvaPay,
        resourceUri,
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
