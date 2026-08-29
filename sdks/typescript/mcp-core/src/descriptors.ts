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
import { SOLVAPAY_BOOTSTRAP_MIME_TYPE, SOLVAPAY_BOOTSTRAP_URI } from './resources/bootstrap'
import {
  solvapayOverviewBody,
  SOLVAPAY_OVERVIEW_MIME_TYPE,
  SOLVAPAY_OVERVIEW_URI,
} from './resources/overview'
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

  const enabledViews = new Set<SolvaPayMcpViewKind>(views)
  const prompts = buildSolvaPayPrompts({ enabledViews })

  const docsResources: SolvaPayDocsResourceDescriptor[] = [
    {
      uri: SOLVAPAY_OVERVIEW_URI,
      name: 'SolvaPay MCP — overview',
      title: 'SolvaPay overview',
      description:
        'Agent-facing "start here" doc — explains the five intent tools, dual-audience fallback, and auth model before any tool is called.',
      mimeType: SOLVAPAY_OVERVIEW_MIME_TYPE,
      readBody: () => solvapayOverviewBody(),
    },
  ]

  const bootstrapResource: SolvaPayBootstrapResourceDescriptor = {
    uri: SOLVAPAY_BOOTSTRAP_URI,
    name: 'SolvaPay bootstrap',
    title: 'SolvaPay bootstrap',
    description:
      'Current merchant/product/plans/customer snapshot for the embedded UI. Widgets read this idempotently when the host scrubs structuredContent from tool results.',
    mimeType: SOLVAPAY_BOOTSTRAP_MIME_TYPE,
  }

  return { tools, resource, prompts, docsResources, bootstrapResource }
}

export function buildSolvaPayPrompts(
  options: { enabledViews?: Set<SolvaPayMcpViewKind> } = {},
): SolvaPayPromptDescriptor[] {
  const enabled = options.enabledViews ?? new Set<SolvaPayMcpViewKind>(DEFAULT_VIEWS)
  const prompts: SolvaPayPromptDescriptor[] = []

  if (enabled.has('checkout')) {
    prompts.push({
      name: MCP_TOOL_NAMES.upgrade,
      title: 'Upgrade plan',
      description: 'Start or change a paid plan for the current customer.',
      argsSchema: { planRef: z.string().optional() },
      handler: args => buildPromptUserMessage(MCP_TOOL_NAMES.upgrade, args),
    })
  }

  if (enabled.has('account')) {
    prompts.push({
      name: MCP_TOOL_NAMES.manageAccount,
      title: 'Manage account',
      description:
        'Show the current plan, balance, payment method, and cancel/reactivate controls for the current customer.',
      handler: args => buildPromptUserMessage(MCP_TOOL_NAMES.manageAccount, args),
    })
  }

  if (enabled.has('topup')) {
    prompts.push({
      name: MCP_TOOL_NAMES.topup,
      title: 'Top up credits',
      description: 'Add SolvaPay credits to the current customer.',
      argsSchema: { amount: z.string().optional() },
      handler: args => buildPromptUserMessage(MCP_TOOL_NAMES.topup, args),
    })
  }

  if (enabled.has('checkout')) {
    prompts.push({
      name: MCP_TOOL_NAMES.activatePlan,
      title: 'Activate plan',
      description: 'Pick a plan to activate, or activate a specific plan by ref.',
      argsSchema: { planRef: z.string().optional() },
      handler: args => buildPromptUserMessage(MCP_TOOL_NAMES.activatePlan, args),
    })
  }

  return prompts
}
