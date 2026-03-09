import { Tool } from '@modelcontextprotocol/sdk/types.js'
import { createTask, deleteTask, getTask, listTasks } from '@solvapay/demo-services'
import { payable, paywallEnabled, solvaPay, solvapayProductRef } from './config'
import type { CreateTaskArgs, DeleteTaskArgs, GetTaskArgs, ListTasksArgs } from './types/mcp'

const getCustomerRef = (args: Record<string, unknown>) => {
  const auth = args?._auth as { customer_ref?: string } | undefined
  return auth?.customer_ref || 'anonymous'
}

// ── Virtual tools (get_user_info, upgrade, manage_account) ─────────────

const virtualTools = solvaPay
  ? solvaPay.getVirtualTools({ product: solvapayProductRef, getCustomerRef })
  : []

// ── Business tools ─────────────────────────────────────────────────────

const businessTools: Tool[] = [
  {
    name: 'create_task',
    description: 'Create a new task (OAuth bearer token required)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_task',
    description: 'Get task by ID (OAuth bearer token required)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks (OAuth bearer token required)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
    },
  },
  {
    name: 'delete_task',
    description: 'Delete task by ID (OAuth bearer token required)',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Task id' },
      },
      required: ['id'],
    },
  },
]

// Virtual tools first, then business tools (matching hosted MCP Pay ordering)
export const tools: Tool[] = [
  ...virtualTools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
  ...businessTools,
]

// ── Business tool handlers (paywall-protected) ─────────────────────────

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

// When paywall is disabled, wrap business logic in MCP response format directly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function directMcp(fn: (args: any) => Promise<unknown>) {
  return async (args: Record<string, unknown>) => ({
    content: [{ type: 'text', text: JSON.stringify(await fn(args)) }],
  })
}

const wrap =
  paywallEnabled && payable
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn: (args: any) => Promise<unknown>) => payable!.mcp(fn, { getCustomerRef })
    : directMcp

const virtualToolHandlers = Object.fromEntries(virtualTools.map(t => [t.name, t.handler]))

export const toolHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  ...virtualToolHandlers,
  create_task: wrap(createTaskMCP),
  get_task: wrap(getTaskMCP),
  list_tasks: wrap(listTasksMCP),
  delete_task: wrap(deleteTaskMCP),
}
