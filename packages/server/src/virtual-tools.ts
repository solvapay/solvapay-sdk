/**
 * Virtual Tools for MCP Server Monetization
 *
 * Provides the same self-service tools (get_user_info, upgrade, manage_account)
 * that hosted MCP Pay servers get automatically, but for SDK-integrated servers.
 * These tools are NOT usage-tracked and bypass the paywall.
 */

import type { SolvaPayClient } from './types'

// ── Types ──────────────────────────────────────────────────────────────

export interface VirtualToolsOptions {
  /** Product reference (required) */
  product: string
  /** Extract customer reference from MCP tool args */
  getCustomerRef: (args: Record<string, unknown>) => string
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
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }>
}

// ── Tool Definitions (matching hosted MCP Pay) ─────────────────────────

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

function mcpErrorResult(message: string) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }
}

function createGetUserInfoHandler(
  apiClient: SolvaPayClient,
  productRef: string,
  getCustomerRef: (args: Record<string, unknown>) => string,
) {
  return async (args: Record<string, unknown>) => {
    const customerRef = getCustomerRef(args)

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
  getCustomerRef: (args: Record<string, unknown>) => string,
) {
  return async (args: Record<string, unknown>) => {
    const customerRef = getCustomerRef(args)
    const planRef = typeof args.planRef === 'string' ? args.planRef : undefined

    try {
      const result = await apiClient.createCheckoutSession({
        customerReference: customerRef,
        productRef,
        ...(planRef && { planRef }),
      })

      const checkoutUrl = result.checkoutUrl

      if (planRef) {
        const responseText =
          `## Upgrade\n\n` +
          `**[Click here to upgrade →](${checkoutUrl})**\n\n` +
          `After completing the checkout, your purchase will be activated immediately.`
        return mcpTextResult(responseText)
      }

      const responseText =
        `## Upgrade Your Subscription\n\n` +
        `**[Click here to view pricing options and upgrade →](${checkoutUrl})**\n\n` +
        `You'll be able to compare options and select the one that's right for you.`
      return mcpTextResult(responseText)
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
  getCustomerRef: (args: Record<string, unknown>) => string,
) {
  return async (args: Record<string, unknown>) => {
    const customerRef = getCustomerRef(args)

    try {
      const session = await apiClient.createCustomerSession({ customerRef, productRef })
      const portalUrl = session.customerUrl

      const responseText =
        `## Manage Your Account\n\n` +
        `Access your account management portal to:\n` +
        `- View your current account status\n` +
        `- See billing history and invoices\n` +
        `- Update payment methods\n` +
        `- Cancel or modify your subscription\n\n` +
        `**[Open Account Portal →](${portalUrl})**\n\n` +
        `This link is secure and will expire after a short period.`
      return mcpTextResult(responseText)
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
