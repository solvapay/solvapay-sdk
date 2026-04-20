import fs from 'node:fs/promises'
import path from 'node:path'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  checkPurchaseCore,
  createCheckoutSessionCore,
  createCustomerSessionCore,
  getPaymentMethodCore,
  isErrorResult,
  syncCustomerCore,
  type McpToolExtra,
} from '@solvapay/server'
import { MCP_TOOL_NAMES } from '@solvapay/react/mcp'
import { solvaPay, solvapayProductRef } from './config'

const DIST_DIR = import.meta.filename.endsWith('.ts')
  ? path.join(import.meta.dirname, '../dist')
  : import.meta.dirname

const resourceUri = 'ui://mcp-checkout-app/mcp-app.html'

function getCustomerRef(extra?: McpToolExtra): string | null {
  const fromExtra = extra?.authInfo?.extra?.customer_ref
  if (typeof fromExtra === 'string' && fromExtra.trim()) {
    return fromExtra.trim()
  }
  return null
}

/**
 * Build a synthetic Web Request the core helpers can consume. The `x-user-id`
 * header is what `getAuthenticatedUserCore` uses as the authoritative user
 * identity (see packages/server/src/helpers/auth.ts), so forwarding the
 * `customer_ref` from the MCP OAuth bridge keeps the entire flow headless.
 */
function buildRequest(
  extra: McpToolExtra | undefined,
  options: {
    method?: string
    query?: Record<string, string | undefined>
    body?: unknown
  } = {},
): Request {
  const { method = 'GET', query, body } = options
  const url = new URL('http://mcp-checkout-app.local/')
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value)
    }
  }

  const headers = new Headers()
  const customerRef = getCustomerRef(extra)
  if (customerRef) {
    headers.set('x-user-id', customerRef)
  }
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(body)
  }
  return new Request(url, init)
}

function toolResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  }
}

function toolErrorResult(error: { error: string; status: number; details?: string }): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(error) }],
    structuredContent: error as unknown as Record<string, unknown>,
  }
}

function previewJson(value: unknown, max = 400): string {
  try {
    const json = JSON.stringify(value)
    if (!json) return String(value)
    return json.length > max ? `${json.slice(0, max)}…(+${json.length - max} chars)` : json
  } catch {
    return String(value)
  }
}

async function traceTool<TArgs extends Record<string, unknown>>(
  name: string,
  args: TArgs,
  extra: McpToolExtra | undefined,
  handler: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const started = Date.now()
  const customerRef = getCustomerRef(extra)
  console.error(`[mcp-checkout-app] -> ${name}`, {
    customerRef: customerRef ?? null,
    args: previewJson(args),
  })
  try {
    const result = await handler()
    const ms = Date.now() - started
    if (result.isError) {
      console.error(`[mcp-checkout-app] <- ${name} ERROR in ${ms}ms`, {
        body: previewJson(result.structuredContent ?? result.content),
      })
    } else {
      console.error(`[mcp-checkout-app] <- ${name} ok in ${ms}ms`, {
        body: previewJson(result.structuredContent ?? result.content),
      })
    }
    return result
  } catch (err) {
    const ms = Date.now() - started
    console.error(`[mcp-checkout-app] <- ${name} THREW in ${ms}ms`, err)
    throw err
  }
}

function requireCustomerRef(extra?: McpToolExtra): CallToolResult | string {
  const customerRef = getCustomerRef(extra)
  if (!customerRef) {
    return toolErrorResult({
      error: 'Unauthorized',
      status: 401,
      details: 'customer_ref missing from MCP auth context',
    })
  }
  return customerRef
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'solvapay-mcp-checkout-app',
    version: '1.0.0',
  })

  const toolMeta = { ui: { resourceUri } }

  registerAppTool(
    server,
    'open_checkout',
    {
      title: 'Open checkout',
      description: 'Open the SolvaPay checkout UI inside the host.',
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool('open_checkout', args, extra, async () => toolResult({ productRef: solvapayProductRef })),
  )

  registerAppTool(
    server,
    'sync_customer',
    {
      description: 'Ensure the authenticated MCP user exists as a SolvaPay customer.',
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool('sync_customer', args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await syncCustomerCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult({ customerRef: result })
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.checkPurchase,
    {
      description: 'Fetch the active purchase for the authenticated customer.',
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.checkPurchase, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await checkPurchaseCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.createCheckoutSession,
    {
      description:
        'Create a SolvaPay hosted checkout session and return its URL. The UI opens this URL in a new tab because Stripe.js is blocked inside the MCP host sandbox. returnUrl is intentionally unset — there is no meaningful URL for the MCP iframe to return to, so the SolvaPay backend default is used.',
      inputSchema: {
        planRef: z.string().optional(),
        productRef: z.string().optional(),
      },
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.createCheckoutSession, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const productRef = typeof args.productRef === 'string' && args.productRef
          ? args.productRef
          : solvapayProductRef
        const planRef = typeof args.planRef === 'string' && args.planRef ? args.planRef : undefined

        const result = await createCheckoutSessionCore(
          buildRequest(extra, { method: 'POST' }),
          { productRef, planRef },
          { solvaPay },
        )
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.getPaymentMethod,
    {
      description:
        "Return the customer's default card brand / last4 / expiry so the UI can render a \"Visa •••• 4242\" line on the current-plan card. Returns { kind: 'none' } when no card is on file.",
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.getPaymentMethod, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth
        const result = await getPaymentMethodCore(buildRequest(extra), { solvaPay })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppTool(
    server,
    MCP_TOOL_NAMES.createCustomerSession,
    {
      description:
        'Create a SolvaPay hosted customer portal session and return its URL. Used to let a paid customer manage or cancel their purchase in a new tab.',
      inputSchema: {},
      _meta: toolMeta,
    },
    async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
      traceTool(MCP_TOOL_NAMES.createCustomerSession, args, extra, async () => {
        const auth = requireCustomerRef(extra)
        if (typeof auth !== 'string') return auth

        const result = await createCustomerSessionCore(buildRequest(extra, { method: 'POST' }), {
          solvaPay,
        })
        if (isErrorResult(result)) return toolErrorResult(result)
        return toolResult(result)
      }),
  )

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, 'mcp-app.html'), 'utf-8')
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      }
    },
  )

  return server
}
