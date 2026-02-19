/**
 * MCP Adapter for Model Context Protocol servers
 *
 * Handles MCP tool format with content wrapping
 */

import type { Adapter } from './base'
import { AdapterUtils } from './base'
import type { McpAdapterOptions, PaywallToolResult } from '../types'
import { PaywallError } from '../paywall'

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

  async getCustomerRef(args: McpContext): Promise<string> {
    if (this.options.getCustomerRef) {
      const ref = await this.options.getCustomerRef(args)
      return AdapterUtils.ensureCustomerRef(ref)
    }

    // Extract from args.auth.customer_ref
    const customerRef = args?.auth?.customer_ref || 'anonymous'
    return AdapterUtils.ensureCustomerRef(customerRef)
  }

  formatResponse(result: unknown, _context: McpContext): PaywallToolResult {
    const transformed = this.options.transformResponse
      ? this.options.transformResponse(result)
      : result

    // Wrap plain object in MCP tool result format
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(transformed, null, 2),
        },
      ],
    }
  }

  formatError(error: Error, _context: McpContext): PaywallToolResult {
    if (error instanceof PaywallError) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: 'Payment required',
                product: error.structuredContent.product,
                checkoutUrl: error.structuredContent.checkoutUrl,
                message: error.structuredContent.message,
              },
              null,
              2,
            ),
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
