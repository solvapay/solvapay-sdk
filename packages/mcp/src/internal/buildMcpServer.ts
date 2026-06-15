/**
 * Shared `McpServer` construction + descriptor-registration loop used
 * by both the `.` entry (`createSolvaPayMcpServer` in `../server.ts`)
 * and the `./fetch` entry (`createSolvaPayMcpFetch` in
 * `../fetch/createSolvaPayMcpFetch.ts`).
 *
 * Lifted here so the two public factories stop duplicating the same
 * 80-line registration wiring. Both entrypoints get the exact same
 * server shape (11 tools + prompts + docs resource + UI resource)
 * without importing from each other — Node consumers keep their
 * existing import path, fetch-first consumers keep theirs, and the
 * diff-risk from the previous sibling copies is gone.
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
  type ApplyHideToolsByAudienceOptions,
  type BuildSolvaPayDescriptorsOptions,
  type SolvaPayBootstrapResourceDescriptor,
  type SolvaPayDescriptorBundle,
  type SolvaPayDocsResourceDescriptor,
  type SolvaPayPromptDescriptor,
  type SolvaPayToolDescriptor,
} from '@solvapay/mcp-core'

export interface BuildSolvaPayMcpServerOptions extends BuildSolvaPayDescriptorsOptions {
  registerPrompts?: boolean
  registerDocsResources?: boolean
  serverName?: string
  serverVersion?: string
}

export type HideToolsByAudienceConfig =
  | readonly string[]
  | {
      audiences: readonly string[]
      bypassWhen?: ApplyHideToolsByAudienceOptions['bypassWhen']
    }

/**
 * Normalise the public `hideToolsByAudience` shape to the
 * `(audiences, options)` pair `applyHideToolsByAudience` consumes.
 * Splits the array shorthand from the object form so factories can
 * accept either without each unwrapping by hand.
 */
export function normaliseHideToolsByAudience(
  config: HideToolsByAudienceConfig | undefined,
): { audiences: readonly string[] | undefined; options: ApplyHideToolsByAudienceOptions } {
  if (!config) return { audiences: undefined, options: {} }
  if (Array.isArray(config)) return { audiences: config, options: {} }
  const obj = config as { audiences: readonly string[]; bypassWhen?: ApplyHideToolsByAudienceOptions['bypassWhen'] }
  return {
    audiences: obj.audiences,
    options: obj.bypassWhen !== undefined ? { bypassWhen: obj.bypassWhen } : {},
  }
}

export interface BuiltSolvaPayMcpServer {
  server: McpServer
  descriptors: SolvaPayDescriptorBundle
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

function registerBootstrapResource(
  server: McpServer,
  bootstrap: SolvaPayBootstrapResourceDescriptor,
): void {
  server.registerResource(
    bootstrap.name,
    bootstrap.uri,
    {
      ...(bootstrap.title !== undefined ? { title: bootstrap.title } : {}),
      description: bootstrap.description,
      mimeType: bootstrap.mimeType,
    },
    async (_uri, extra): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: bootstrap.uri,
          mimeType: bootstrap.mimeType,
          text: JSON.stringify(await bootstrap.readPayload(extra)),
        },
      ],
    }),
  )
}

/**
 * Build the `McpServer` from a `BuildSolvaPayDescriptorsOptions`
 * bundle, register every SolvaPay tool / prompt / docs resource / UI
 * resource, and return the server alongside the descriptor bundle.
 *
 * Callers apply their own `additionalTools` hook and the
 * `hideToolsByAudience` filter on the returned server — those two
 * steps intentionally live on the public factories so the filter
 * always runs after the caller's `additionalTools` callback, and the
 * factory's binding of `registerPayable` can stay flavour-specific
 * (the root `.` entry binds it via `registerPayableTool`; the
 * fetch-first entry deliberately leaves it unbound per its
 * architectural guarantee).
 */
export function buildSolvaPayMcpServer(
  options: BuildSolvaPayMcpServerOptions,
): BuiltSolvaPayMcpServer {
  const {
    registerPrompts = true,
    registerDocsResources = true,
    serverName,
    serverVersion = '1.0.0',
    ...descriptorOptions
  } = options

  const descriptors = buildSolvaPayDescriptors(descriptorOptions)

  // Prefer the merchant's brand name + icon for the MCP
  // `Implementation` payload returned at `initialize` — hosts render
  // both in the chrome strip next to the tool name (Claude Web /
  // Desktop swap the default globe for `serverInfo.icons[0]`), so
  // surfacing the merchant there is what gives the widget its "native
  // merchant app" look. Explicit `serverName` still wins when the
  // integrator needs a stable protocol identifier distinct from the
  // brand. `deriveIcons` returns `undefined` when branding has neither
  // `iconUrl` nor `logoUrl`; we omit the field in that case so the
  // serialised handshake matches the zero-branding baseline.
  const effectiveServerName =
    serverName ?? descriptorOptions.branding?.brandName ?? 'solvapay-mcp-server'
  const serverIcons = deriveIcons(descriptorOptions.branding)

  const server = new McpServer({
    name: effectiveServerName,
    version: serverVersion,
    ...(serverIcons ? { icons: serverIcons } : {}),
  })

  for (const tool of descriptors.tools) {
    registerDescriptor(server, tool)
  }

  if (registerPrompts) {
    for (const prompt of descriptors.prompts) {
      registerPromptDescriptor(server, prompt)
    }
  }

  if (registerDocsResources) {
    for (const docs of descriptors.docsResources) {
      registerDocsResource(server, docs)
    }
  }

  registerBootstrapResource(server, descriptors.bootstrapResource)

  const resource = descriptors.resource
  registerAppResource(
    server,
    resource.uri,
    resource.uri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: {
          csp: resource.csp,
          // `false` asks the host to skip painting its own outer card /
          // border around the iframe. The widget paints its own frame
          // via `.solvapay-mcp-card`, and `<AppHeader>` renders the
          // merchant mark at the top; a host-painted card on top of
          // that produced a nested-container look (visible on MCP Jam
          // with the earlier `true` default). Hosts that honour the
          // preference (per the MCP Apps spec) now render us flush
          // inside their conversation surface.
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

  return { server, descriptors }
}

export { applyHideToolsByAudience }
