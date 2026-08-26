/**
 * Shared `McpServer` construction + descriptor-registration loop used
 * by both the `.` entry (`createSolvaPayMcpServer` in `../server.ts`)
 * and the `./fetch` entry (`createSolvaPayMcpFetch` in
 * `../fetch/createSolvaPayMcpFetch.ts`).
 */

import { McpServer } from '@modelcontextprotocol/server'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
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
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from './extAppsServer'
import { defaultMcpAppHtml } from '../defaultMcpAppHtml'

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

export function normaliseHideToolsByAudience(
  config: HideToolsByAudienceConfig | undefined,
): { audiences: readonly string[] | undefined; options: ApplyHideToolsByAudienceOptions } {
  if (!config) return { audiences: undefined, options: {} }
  if (Array.isArray(config)) return { audiences: config, options: {} }
  const obj = config as {
    audiences: readonly string[]
    bypassWhen?: ApplyHideToolsByAudienceOptions['bypassWhen']
  }
  return {
    audiences: obj.audiences,
    options: obj.bypassWhen !== undefined ? { bypassWhen: obj.bypassWhen } : {},
  }
}

export interface BuiltSolvaPayMcpServer {
  server: McpServer
  descriptors: SolvaPayDescriptorBundle
}

function wrapInputSchema(
  schema: SolvaPayToolDescriptor['inputSchema'],
): z.ZodObject | undefined {
  if (schema === undefined) return undefined
  return z.object(schema)
}

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
      inputSchema: wrapInputSchema(tool.inputSchema),
      _meta: metaWithIcons,
      ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
      ...(tool.icons !== undefined ? { icons: tool.icons } : {}),
    },
    async (args: Record<string, unknown>, ctx?: unknown): Promise<CallToolResult> =>
      (await tool.handler(
        args,
        ctx as Parameters<typeof tool.handler>[1],
      )) as unknown as CallToolResult,
  )
}

function registerPromptDescriptor(server: McpServer, prompt: SolvaPayPromptDescriptor): void {
  const config: {
    title?: string
    description?: string
    argsSchema?: ReturnType<typeof z.object>
  } = { description: prompt.description }
  if (prompt.title !== undefined) config.title = prompt.title
  if (prompt.argsSchema !== undefined) {
    config.argsSchema = z.object(prompt.argsSchema)
  }

  server.registerPrompt(prompt.name, config, async args => (await prompt.handler(args ?? {})) as never)
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
    async (_uri, ctx): Promise<ReadResourceResult> => ({
      contents: [
        {
          uri: bootstrap.uri,
          mimeType: bootstrap.mimeType,
          text: JSON.stringify(await bootstrap.readPayload(ctx)),
        },
      ],
    }),
  )
}

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

  const descriptors = buildSolvaPayDescriptors({
    ...descriptorOptions,
    readHtml:
      descriptorOptions.readHtml ??
      (descriptorOptions.htmlPath ? undefined : defaultMcpAppHtml),
  })

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
