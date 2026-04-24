/**
 * MCP Adapter for Model Context Protocol servers
 *
 * Handles MCP tool format with content wrapping
 */

import type { Adapter } from './base'
import { AdapterUtils } from './base'
import type {
  McpAdapterOptions,
  McpToolExtra,
  PaywallStructuredContent,
  PaywallToolResult,
} from '../types'

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

    const customerRefFromExtra =
      typeof extra?.authInfo?.extra?.customer_ref === 'string'
        ? String(extra.authInfo.extra.customer_ref)
        : undefined
    const customerRefFromArgs =
      typeof args.auth === 'object' &&
      args.auth !== null &&
      typeof (args.auth as Record<string, unknown>).customer_ref === 'string'
        ? String((args.auth as Record<string, unknown>).customer_ref)
        : undefined
    const directCustomerRef = typeof args.customer_ref === 'string' ? args.customer_ref : undefined

    const customerRef = (
      customerRefFromExtra ||
      customerRefFromArgs ||
      directCustomerRef ||
      'anonymous'
    ).trim()
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

  /**
   * Emit a plain-narration paywall response — `content[0].text` carries
   * the gate's human message (LLM-actionable), `structuredContent`
   * carries the machine-readable gate payload, and `isError` stays
   * `false` per the MCP spec's own `isError` definition (paywall is
   * not a self-correctable tool execution error; it is a user-facing
   * control transfer to the UI).
   *
   * Hosts that read widget metadata from `tools/list` or tool-result
   * `_meta.ui` open the paywall iframe on top of this response;
   * `buildPayableHandler` stamps the `_meta.ui.resourceUri` envelope
   * before returning.
   */
  formatGate(gate: PaywallStructuredContent, _context: McpContext): PaywallToolResult {
    return {
      content: [{ type: 'text', text: gate.message }],
      isError: false,
      structuredContent: gate,
    }
  }

  formatError(error: Error, _context: McpContext): PaywallToolResult {
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
