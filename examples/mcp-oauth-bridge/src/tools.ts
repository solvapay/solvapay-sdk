import { Tool } from '@modelcontextprotocol/sdk/types.js'
import { createTask, deleteTask, getTask, listTasks } from '@solvapay/demo-services'
import { payable } from './config'
import type { CreateTaskArgs, DeleteTaskArgs, GetTaskArgs, ListTasksArgs } from './types/mcp'

export const tools: Tool[] = [
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

const getCustomerRef = (args: Record<string, unknown>) => {
  const auth = args?._auth as { customer_ref?: string } | undefined
  return auth?.customer_ref || 'anonymous'
}

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

export const toolHandlers = {
  create_task: payable.mcp(createTaskMCP, { getCustomerRef }),
  get_task: payable.mcp(getTaskMCP, { getCustomerRef }),
  list_tasks: payable.mcp(listTasksMCP, { getCustomerRef }),
  delete_task: payable.mcp(deleteTaskMCP, { getCustomerRef }),
}
