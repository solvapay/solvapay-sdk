/**
 * Framework-neutral descriptor metadata. JSON-RPC handlers live in the
 * Rust engine (`mcpDispatch`); this module only projects `mcpDescriptors`
 * plus host-owned HTML reading into adapter-shaped objects.
 */

import { mcpDescriptors } from './mcp-descriptors'
import { type SolvaPay } from '@solvapay/server'
import { z } from 'zod'
import { logMcpConfigOnce } from './config-log'
import { buildPromptUserMessage, deriveIcons, validatePublicBaseUrl } from './native-mcp'
import { solvapayOverviewBody } from './resources/overview'
import { MCP_TOOL_NAMES } from './tool-names'
import { SOLVAPAY_MCP_VIEW_KINDS } from './types'
import type {
  McpToolExtra,
  SolvaPayBootstrapResourceDescriptor,
  SolvaPayCallToolResult,
  SolvaPayDocsResourceDescriptor,
  SolvaPayMcpCsp,
  SolvaPayMcpViewKind,
  SolvaPayMerchantBranding,
  SolvaPayPromptDescriptor,
  SolvaPayResourceDescriptor,
  SolvaPayToolDescriptor,
} from './types'

const DEFAULT_VIEWS: SolvaPayMcpViewKind[] = [...SOLVAPAY_MCP_VIEW_KINDS]

export { deriveIcons }

export interface BuildSolvaPayDescriptorsOptions {
  solvaPay: SolvaPay
  productRef: string
  resourceUri: string
  htmlPath?: string
  readHtml?: () => Promise<string>
  publicBaseUrl: string
  views?: SolvaPayMcpViewKind[]
  csp?: SolvaPayMcpCsp
  apiBaseUrl?: string
  getCustomerRef?: (extra?: McpToolExtra) => string | null
  onToolCall?: (name: string, args: unknown, extra?: McpToolExtra) => void
  onToolResult?: (
    name: string,
    result: SolvaPayCallToolResult,
    meta: { durationMs: number },
  ) => void
  branding?: SolvaPayMerchantBranding
}

export interface SolvaPayDescriptorBundle {
  tools: SolvaPayToolDescriptor[]
  resource: SolvaPayResourceDescriptor
  prompts: SolvaPayPromptDescriptor[]
  docsResources: SolvaPayDocsResourceDescriptor[]
  bootstrapResource: SolvaPayBootstrapResourceDescriptor
}

export function buildSolvaPayDescriptors(
  options: BuildSolvaPayDescriptorsOptions,
): SolvaPayDescriptorBundle {
  const {
    productRef,
    resourceUri,
    htmlPath,
    readHtml,
    publicBaseUrl,
    views = DEFAULT_VIEWS,
    csp,
    apiBaseUrl,
    branding,
  } = options

  if (!htmlPath && !readHtml) {
    throw new Error(
      'buildSolvaPayDescriptors: either `htmlPath` (node) or `readHtml` (edge) must be provided.',
    )
  }

  const urlError = validatePublicBaseUrl(publicBaseUrl)
  if (urlError) throw new Error(urlError)

  logMcpConfigOnce({
    apiBaseUrl: apiBaseUrl ?? '(unset)',
    productRef,
    publicBaseUrl,
  })

  const coreDescriptors = mcpDescriptors({
    resourceUri,
    publicBaseUrl,
    productRef,
    views,
    ...(csp !== undefined ? { csp } : {}),
    ...(apiBaseUrl !== undefined ? { apiBaseUrl } : {}),
    ...(branding !== undefined ? { branding } : {}),
  })

  const tools: SolvaPayToolDescriptor[] = coreDescriptors.tools.map(tool => ({
    name: tool.name,
    ...(tool.title !== undefined ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: {},
    ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : {}),
    meta: tool.meta,
    annotations: tool.annotations as SolvaPayToolDescriptor['annotations'],
    ...(tool.icons !== undefined ? { icons: tool.icons as SolvaPayToolDescriptor['icons'] } : {}),
  }))

  const resource: SolvaPayResourceDescriptor = {
    uri: resourceUri,
    mimeType: 'text/html;profile=mcp-app',
    csp: coreDescriptors.csp,
    readHtml: readHtml
      ? readHtml
      : async () => {
          const fs = await import('node:fs/promises')
          return fs.readFile(htmlPath as string, 'utf-8')
        },
  }

  const prompts = buildSolvaPayPrompts({ prompts: coreDescriptors.prompts })

  const docsResources: SolvaPayDocsResourceDescriptor[] = [
    {
      uri: requiredDescriptorString(coreDescriptors.docs, 'uri'),
      name: requiredDescriptorString(coreDescriptors.docs, 'name'),
      title: requiredDescriptorString(coreDescriptors.docs, 'title'),
      description: requiredDescriptorString(coreDescriptors.docs, 'description'),
      mimeType: requiredDescriptorString(coreDescriptors.docs, 'mimeType'),
      readBody: () => solvapayOverviewBody(),
    },
  ]

  const bootstrapResource: SolvaPayBootstrapResourceDescriptor = {
    uri: requiredDescriptorString(coreDescriptors.bootstrap, 'uri'),
    name: requiredDescriptorString(coreDescriptors.bootstrap, 'name'),
    title: requiredDescriptorString(coreDescriptors.bootstrap, 'title'),
    description: requiredDescriptorString(coreDescriptors.bootstrap, 'description'),
    mimeType: requiredDescriptorString(coreDescriptors.bootstrap, 'mimeType'),
  }

  return { tools, resource, prompts, docsResources, bootstrapResource }
}

export function buildSolvaPayPrompts(
  options: {
    enabledViews?: Set<SolvaPayMcpViewKind>
    prompts?: Array<{ name: string; title: string; description: string }>
  } = {},
): SolvaPayPromptDescriptor[] {
  const corePrompts =
    options.prompts ??
    mcpDescriptors({
      resourceUri: 'ui://solvapay/prompt-descriptors',
      publicBaseUrl: 'https://example.invalid',
      productRef: 'prd_prompt_descriptors',
      views: options.enabledViews ? [...options.enabledViews] : [...DEFAULT_VIEWS],
    }).prompts

  return corePrompts.map(prompt => ({
    name: prompt.name,
    title: prompt.title,
    description: prompt.description,
    ...promptArgsSchema(prompt.name),
    handler: args => buildPromptUserMessage(prompt.name, args),
  }))
}

function promptArgsSchema(name: string): { argsSchema?: Record<string, z.ZodTypeAny> } {
  if (name === MCP_TOOL_NAMES.upgrade || name === MCP_TOOL_NAMES.activatePlan) {
    return { argsSchema: { planRef: z.string().optional() } }
  }
  if (name === MCP_TOOL_NAMES.topup) {
    return { argsSchema: { amount: z.string().optional() } }
  }
  return {}
}

function requiredDescriptorString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`mcpDescriptors ${key} must be a non-empty string`)
  }
  return value
}
