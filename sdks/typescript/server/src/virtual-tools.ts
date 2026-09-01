/**
 * Virtual Tools for MCP Server Monetization
 *
 * Provides the same self-service tools (get_user_info, upgrade, manage_account)
 * that hosted MCP servers get automatically, but for SDK-integrated servers.
 * These tools are NOT usage-tracked and bypass the paywall.
 */

import type { SolvaPayClient } from './types'
import type { McpToolExtra } from './types'
import { callNativeSync } from './native'

// ── Types ──────────────────────────────────────────────────────────────

export interface VirtualToolsOptions {
  /** Product reference (required) */
  product: string
  /** Extract customer reference from MCP tool args */
  getCustomerRef: (args: Record<string, unknown>, extra?: McpToolExtra) => string
  /** Tool names to exclude from registration (optional) */
  exclude?: string[]
}

export interface VirtualToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, object>
    required: string[]
  }
  handler: (
    args: Record<string, unknown>,
    extra?: McpToolExtra,
  ) => Promise<{
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }>
}

// ── Tool Definitions (matching hosted MCP servers) ─────────────────────

const TOOL_GET_USER_INFO = {
  name: 'get_user_info',
  description:
    'Get information about the current user and their purchase status for this MCP server. ' +
    'Returns user profile (reference, name, email) and active purchase details including product name, ' +
    'type, dates, and usage limit if applicable.',
  inputSchema: {
    type: 'object' as const,
    properties: {} as Record<string, object>,
    required: [] as string[],
  },
}

const TOOL_UPGRADE = {
  name: 'upgrade',
  description:
    'Get available pricing options and checkout URLs for upgrading. ' +
    'Returns a list of available pricing options with their details (price, features) and checkout URLs. ' +
    'Users can click on a checkout URL to purchase. If a specific planRef is provided, ' +
    'returns only the checkout URL for that pricing option.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      planRef: {
        type: 'string',
        description:
          'Optional pricing reference (e.g., "pln_abc123") to get a checkout URL for a specific option. ' +
          'If not provided, returns all available pricing options with their checkout URLs.',
      },
    } as Record<string, object>,
    required: [] as string[],
  },
}

const TOOL_MANAGE_ACCOUNT = {
  name: 'manage_account',
  description:
    'Get a URL to the customer portal where users can view and manage their account. ' +
    'The portal shows current account status, billing history, and allows subscription changes. ' +
    'Returns a secure, time-limited URL that the user can click to access their account management page.',
  inputSchema: {
    type: 'object' as const,
    properties: {} as Record<string, object>,
    required: [] as string[],
  },
}

export const VIRTUAL_TOOL_DEFINITIONS = [TOOL_GET_USER_INFO, TOOL_UPGRADE, TOOL_MANAGE_ACCOUNT]

// ── Tool Handlers ──────────────────────────────────────────────────────

function mcpTextResult(text: string) {
  return { content: [{ type: 'text', text }] }
}

function virtualToolMarkdown(tool: string, payload: Record<string, unknown>): string {
  const narrated = callNativeSync(
    'solvapayCall',
    JSON.stringify({ op: 'mcpNarrate', args: { tool, payload } }),
  )
  if (typeof narrated !== 'object' || narrated === null || !('text' in narrated)) {
    throw new Error('mcpNarrate virtual tool did not return text')
  }
  const text = (narrated as { text: unknown }).text
  if (typeof text !== 'string') {
    throw new Error('mcpNarrate virtual tool text must be a string')
  }
  return text
}

function mcpErrorResult(message: string) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }
}

function createGetUserInfoHandler(
  apiClient: SolvaPayClient,
  productRef: string,
  getCustomerRef: (args: Record<string, unknown>, extra?: McpToolExtra) => string,
) {
  return async (args: Record<string, unknown>, extra?: McpToolExtra) => {
    const customerRef = getCustomerRef(args, extra)

    try {
      if (!apiClient.getUserInfo) {
        return mcpErrorResult('getUserInfo is not available on this API client')
      }

      const userInfo = await apiClient.getUserInfo({ customerRef, productRef })
      return mcpTextResult(JSON.stringify(userInfo, null, 2))
    } catch (error) {
      return mcpErrorResult(
        `Failed to retrieve user information: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }
}

function createUpgradeHandler(
  apiClient: SolvaPayClient,
  productRef: string,
  getCustomerRef: (args: Record<string, unknown>, extra?: McpToolExtra) => string,
) {
  return async (args: Record<string, unknown>, extra?: McpToolExtra) => {
    const customerRef = getCustomerRef(args, extra)
    const planRef = typeof args.planRef === 'string' ? args.planRef : undefined

    try {
      const result = await apiClient.createCheckoutSession({
        customerRef,
        productRef,
        ...(planRef && { planRef }),
      })

      const checkoutUrl = result.checkoutUrl

      return mcpTextResult(
        virtualToolMarkdown('virtual_upgrade', {
          checkoutUrl,
          ...(planRef !== undefined ? { planRef } : {}),
        }),
      )
    } catch (error) {
      return mcpErrorResult(
        `Failed to create checkout session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }
}

function createManageAccountHandler(
  apiClient: SolvaPayClient,
  productRef: string,
  getCustomerRef: (args: Record<string, unknown>, extra?: McpToolExtra) => string,
) {
  return async (args: Record<string, unknown>, extra?: McpToolExtra) => {
    const customerRef = getCustomerRef(args, extra)

    try {
      const session = await apiClient.createCustomerSession({ customerRef, productRef })
      const portalUrl = session.customerUrl

      return mcpTextResult(virtualToolMarkdown('virtual_manage_account', { portalUrl }))
    } catch (error) {
      return mcpErrorResult(
        `Failed to create customer portal session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────

export function createVirtualTools(
  apiClient: SolvaPayClient,
  options: VirtualToolsOptions,
): VirtualToolDefinition[] {
  const { product, getCustomerRef, exclude = [] } = options
  const excludeSet = new Set(exclude)

  const allTools: VirtualToolDefinition[] = [
    {
      ...TOOL_GET_USER_INFO,
      handler: createGetUserInfoHandler(apiClient, product, getCustomerRef),
    },
    {
      ...TOOL_UPGRADE,
      handler: createUpgradeHandler(apiClient, product, getCustomerRef),
    },
    {
      ...TOOL_MANAGE_ACCOUNT,
      handler: createManageAccountHandler(apiClient, product, getCustomerRef),
    },
  ]

  return allTools.filter(t => !excludeSet.has(t.name))
}
