import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createTask, deleteTask, getTask, listTasks } from '@solvapay/demo-services'
import type { McpServerLike } from '@solvapay/server'
import { z } from 'zod'
import { payable, paywallEnabled, solvaPay, solvapayProductRef } from './config'
import type { CreateTaskArgs, DeleteTaskArgs, GetTaskArgs, ListTasksArgs } from './types/mcp'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolHandler = (args: any, extra?: unknown) => Promise<any>

function directMcp(fn: (args: Record<string, unknown>) => Promise<unknown>): ToolHandler {
  return async args => ({
    content: [{ type: 'text', text: JSON.stringify(await fn(args), null, 2) }],
  })
}

const wrapTool =
  paywallEnabled && payable
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn: (args: any) => Promise<unknown>): ToolHandler => {
        const wrapped = payable!.mcp(fn as any)
        return async (args, extra) => (wrapped as any)(args, extra)
      }
    : directMcp

async function createTaskMCP(args: CreateTaskArgs) {
  const result = await createTask(args)
  return {
    success: result.success,
    message: 'Task created successfully',
    task: result.task,
  }
}

async function getTaskMCP(args: GetTaskArgs) {
  const result = await getTask(args)
  return {
    success: result.success,
    task: result.task,
  }
}

async function listTasksMCP(args: ListTasksArgs) {
  const result = await listTasks(args)
  return {
    success: result.success,
    tasks: result.tasks,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  }
}

async function deleteTaskMCP(args: DeleteTaskArgs) {
  const result = await deleteTask(args)
  return {
    success: result.success,
    message: result.message,
    deletedTask: result.deletedTask,
  }
}

export function createMCPServer(): McpServer {
  const server = new McpServer(
    {
      name: 'solvapay-oauth-bridge-mcp-server',
      version: '2.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  if (solvaPay) {
    // MCP SDK 1.28 registerTool typing is broader than the current SolvaPay McpServerLike contract.
    // Runtime shape is compatible; cast keeps this example type-safe until the SDK types are widened.
    void solvaPay.registerVirtualToolsMcp(server as unknown as McpServerLike, {
      product: solvapayProductRef,
    })
  }

  const createTaskHandler = wrapTool(createTaskMCP)
  server.registerTool(
    'create_task',
    {
      description: 'Create a new task (OAuth bearer token required)',
      inputSchema: {
        title: z.string().describe('Task title'),
        description: z.string().optional().describe('Task description'),
      },
    },
    async (args, extra) => createTaskHandler(args, extra),
  )

  const getTaskHandler = wrapTool(getTaskMCP)
  server.registerTool(
    'get_task',
    {
      description: 'Get task by ID (OAuth bearer token required)',
      inputSchema: {
        id: z.string().describe('Task id'),
      },
    },
    async (args, extra) => getTaskHandler(args, extra),
  )

  const listTasksHandler = wrapTool(listTasksMCP)
  server.registerTool(
    'list_tasks',
    {
      description: 'List tasks (OAuth bearer token required)',
      inputSchema: {
        limit: z.number().optional(),
        offset: z.number().optional(),
      },
    },
    async (args, extra) => listTasksHandler(args, extra),
  )

  const deleteTaskHandler = wrapTool(deleteTaskMCP)
  server.registerTool(
    'delete_task',
    {
      description: 'Delete task by ID (OAuth bearer token required)',
      inputSchema: {
        id: z.string().describe('Task id'),
      },
    },
    async (args, extra) => deleteTaskHandler(args, extra),
  )

  return server
}
