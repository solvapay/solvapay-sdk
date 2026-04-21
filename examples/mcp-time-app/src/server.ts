import fs from 'node:fs/promises'
import path from 'node:path'
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { payable, paywallEnabled, solvaPay, solvapayProductRef } from './config'
import type { McpToolExtra } from '@solvapay/mcp'
import { jsonSchemaToZodRawShape } from '@solvapay/server'

const DIST_DIR = import.meta.filename.endsWith('.ts')
  ? path.join(import.meta.dirname, '../dist')
  : import.meta.dirname

const resourceUri = 'ui://mcp-time-app/mcp-app.html'

function createTimeResult() {
  const currentTime = new Date().toLocaleString()
  return { currentTime }
}

type JsonSchemaProperty = {
  type?: string
  enum?: unknown[]
  items?: JsonSchemaProperty
  properties?: Record<string, JsonSchemaProperty>
}

function registerVirtualAppTools(server: McpServer) {
  if (!solvaPay) return

  const virtualTools = solvaPay.getVirtualTools({
    product: solvapayProductRef,
    getCustomerRef: (_args, extra) => {
      const fromExtra = extra?.authInfo?.extra?.customer_ref
      return typeof fromExtra === 'string' && fromExtra.trim() ? fromExtra.trim() : 'anonymous'
    },
  })

  for (const tool of virtualTools) {
    const inputSchema = jsonSchemaToZodRawShape(
      tool.inputSchema.properties as Record<string, JsonSchemaProperty>,
      tool.inputSchema.required || [],
    ) as unknown as Record<string, z.ZodTypeAny>

    registerAppTool(
      server,
      tool.name,
      {
        description: tool.description,
        inputSchema,
        _meta: {
          ui: {
            resourceUri,
          },
        },
      },
      async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
        (await tool.handler(args, extra)) as CallToolResult,
    )
  }
}

export function createServer() {
  const server = new McpServer({
    name: 'solvapay-mcp-time-app',
    version: '1.0.0',
  })

  registerVirtualAppTools(server)

  const directTimeHandler = async (): Promise<CallToolResult> => {
    const result = createTimeResult()
    return {
      content: [{ type: 'text', text: result.currentTime }],
      structuredContent: result,
    }
  }

  const payableTimeHandler = payable?.mcp(async () => createTimeResult())
  const timeHandler = paywallEnabled && payableTimeHandler
    ? async (args: Record<string, unknown>, extra?: McpToolExtra): Promise<CallToolResult> =>
        (await payableTimeHandler(args, extra)) as CallToolResult
    : async (): Promise<CallToolResult> => directTimeHandler()
  const timeOutputSchema = z
    .object({
      currentTime: z.string().optional(),
      kind: z.literal('payment_required').optional(),
      product: z.string().optional(),
      checkoutUrl: z.string().optional(),
      message: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      const isSuccess =
        typeof value.currentTime === 'string' &&
        value.kind === undefined &&
        value.product === undefined &&
        value.checkoutUrl === undefined &&
        value.message === undefined

      const isPaywall =
        value.kind === 'payment_required' &&
        typeof value.product === 'string' &&
        typeof value.checkoutUrl === 'string' &&
        typeof value.message === 'string' &&
        value.currentTime === undefined

      if (!isSuccess && !isPaywall) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Output must be either { currentTime } or a payment_required payload.',
        })
      }
    })

  registerAppTool(
    server,
    'get-current-time',
    {
      title: 'Get current time',
      description: 'Returns the current server time in a readable local format.',
      inputSchema: {},
      outputSchema: timeOutputSchema,
      _meta: {
        ui: {
          resourceUri,
        },
      },
    },
    timeHandler,
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
