/**
 * MCP Adapter for Model Context Protocol servers
 *
 * Handles MCP tool format with content wrapping
 */

import type { Adapter } from './base'
import { AdapterUtils } from './base'
import type { McpAdapterOptions, McpToolExtra, PaywallToolResult } from '../types'
import { PaywallError, paywallErrorToClientPayload } from '../paywall'

/**
 * MCP context (plain args object)
 */
type McpContext = Record<string, unknown>

/**
 * MCP Adapter implementation
 */
export class McpAdapter implements Adapter<McpContext, PaywallToolResult> {
  constructor(private options: McpAdapterOptions = {}) {}

  extractArgs(args: McpContext): Record<string, unknown> {
    // MCP args are already plain objects, pass through
    return args
  }

  async getCustomerRef(args: McpContext, extra?: McpToolExtra): Promise<string> {
    if (this.options.getCustomerRef) {
      const ref = await this.options.getCustomerRef(args, extra)
      return AdapterUtils.ensureCustomerRef(ref)
    }

    const customerRefFromExtra = extra?.authInfo?.extra?.customer_ref
    const customerRef =
      typeof customerRefFromExtra === 'string' && customerRefFromExtra.trim()
        ? customerRefFromExtra.trim()
        : 'anonymous'
    return AdapterUtils.ensureCustomerRef(customerRef)
  }

  formatResponse(result: unknown, _context: McpContext): PaywallToolResult {
    const transformed = this.options.transformResponse
      ? this.options.transformResponse(result)
      : result

    const response: PaywallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify(transformed, null, 2),
        },
      ],
    }

    if (transformed && typeof transformed === 'object' && !Array.isArray(transformed)) {
      response.structuredContent = transformed as Record<string, unknown>
    }

    return response
  }

  formatError(error: Error, _context: McpContext): PaywallToolResult {
    if (error instanceof PaywallError) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(paywallErrorToClientPayload(error), null, 2),
          },
        ],
        isError: true,
        structuredContent: error.structuredContent,
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error occurred',
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    }
  }
}
