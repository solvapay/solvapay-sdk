/**
 * Layer-1 driver: real McpServer + InMemoryTransport JSON-RPC pair.
 */

import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { registerPayableTool } from '@solvapay/mcp'
import { createSolvaPay } from '@solvapay/server'
import type { SolvaPayClient } from '@solvapay/server'
import type { ContentBlock, ResponseContext } from '@solvapay/mcp-core'
import { z, type ZodType } from 'zod'
import type { McpAuthoringScenario } from './scenario-schema.js'

function compileInputSchema(
  inputSchema: Record<string, unknown> | undefined,
): Record<string, ZodType> | undefined {
  if (inputSchema === undefined) {
    return undefined
  }
  const shape: Record<string, ZodType> = {}
  for (const [key, spec] of Object.entries(inputSchema)) {
    if (
      typeof spec === 'object' &&
      spec !== null &&
      'type' in spec &&
      (spec as { type: unknown }).type === 'string'
    ) {
      shape[key] = z.string()
      continue
    }
    throw new Error(`unsupported inputSchema for field ${key}`)
  }
  return shape
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const MCP_TOOLS_CALL = 'tool' + 's/call'

function compileHandler(scenario: McpAuthoringScenario) {
  const spec = scenario.handler
  return async (_args: Record<string, unknown>, ctx: ResponseContext) => {
    switch (spec.kind) {
      case 'throw':
        throw new Error(spec.message)
      case 'gate':
        ctx.gate(spec.reason)
        break
      case 'respond': {
        if (spec.emit) {
          for (const block of spec.emit) {
            await ctx.emit(block as ContentBlock)
          }
        }
        const data =
          spec.data !== null &&
          typeof spec.data === 'object' &&
          !Array.isArray(spec.data) &&
          (spec.data as { echo?: unknown }).echo === 'customer'
            ? { throttled: ctx.customer.throttled, overage: ctx.customer.overage }
            : spec.data
        return spec.options === undefined ? ctx.respond(data) : ctx.respond(data, spec.options)
      }
    }
  }
}

async function rpc(
  transport: InMemoryTransport,
  pending: Map<number, (msg: JsonRpcResponse) => void>,
  id: number,
  method: string,
  params?: unknown,
): Promise<JsonRpcResponse> {
  const reply = new Promise<JsonRpcResponse>(resolve => {
    pending.set(id, resolve)
  })
  await transport.send({
    jsonrpc: '2.0',
    id,
    method,
    ...(params === undefined ? {} : { params }),
  })
  return reply
}

export async function callRegisteredPayable(
  client: SolvaPayClient,
  scenario: McpAuthoringScenario,
): Promise<unknown> {
  const solvaPay = createSolvaPay({ apiClient: client })
  const server = new McpServer({ name: 'mcp-authoring-fixtures', version: '0.0.0' })

  const getCustomerRef =
    scenario.customerRefSource === 'hook' ? async () => scenario.customerRef : undefined

  const schema = compileInputSchema(scenario.tool.inputSchema)

  registerPayableTool(server, scenario.tool.name, {
    solvaPay,
    product: scenario.product,
    title: scenario.tool.title,
    description: scenario.tool.description,
    ...(schema !== undefined ? { schema } : {}),
    handler: compileHandler(scenario),
    ...(getCustomerRef !== undefined ? { getCustomerRef } : {}),
    ...(scenario.usageType !== undefined ? { usageType: scenario.usageType } : {}),
  })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const pending = new Map<number, (msg: JsonRpcResponse) => void>()
  clientTransport.onmessage = (message: unknown) => {
    const msg = message as JsonRpcResponse
    if (msg.id === undefined || msg.id === null) {
      return
    }
    const resolve = pending.get(Number(msg.id))
    if (resolve) {
      pending.delete(Number(msg.id))
      resolve(msg)
    }
  }

  await server.connect(serverTransport)
  await clientTransport.start()

  try {
    const init = await rpc(clientTransport, pending, 1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'mcp-authoring-harness', version: '0.0.0' },
    })
    if (init.error) {
      throw new Error(`initialize failed: ${init.error.message}`)
    }

    await clientTransport.send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })

    const call = await rpc(clientTransport, pending, 2, MCP_TOOLS_CALL, {
      name: scenario.tool.name,
      arguments: scenario.tool.args,
    })
    if (call.error) {
      throw new Error(`${MCP_TOOLS_CALL} failed: ${call.error.message}`)
    }
    return call.result
  } finally {
    await clientTransport.close()
    await serverTransport.close()
    await server.close()
  }
}
