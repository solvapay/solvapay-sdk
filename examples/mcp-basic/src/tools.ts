import { Tool } from '@modelcontextprotocol/sdk/types.js'
import { createTask, getTask, listTasks, deleteTask } from '@solvapay/demo-services'
import type {
  CreateTaskArgs,
  GetTaskArgs,
  ListTasksArgs,
  DeleteTaskArgs,
} from './types/mcp'
import { payable } from './config'

/**
 * Define available tools for the MCP server
 */
export const tools: Tool[] = [
  {
    name: 'create_task',
    description: 'Create a new task (requires payment after free tier)',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the task to create',
        },
        description: {
          type: 'string',
          description: 'Optional description of the task',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'get_task',
    description: 'Get a task by ID (requires payment after free tier)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the task to retrieve',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all tasks (requires payment after free tier)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of tasks to return (default: 10)',
        },
        offset: {
          type: 'number',
          description: 'Number of tasks to skip (default: 0)',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task by ID (requires payment after free tier)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'ID of the task to delete',
        },
        auth: {
          type: 'object',
          description: 'Authentication information',
          properties: {
            customer_ref: { type: 'string' },
          },
        },
      },
      required: ['id'],
    },
  },
]

/**
 * CRUD operation handlers - wrapping shared service functions
 */
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

/**
 * Tool handler map for routing tool calls to their respective handlers
 */
export const toolHandlers = {
  create_task: async (args: CreateTaskArgs) => {
    const handler = payable.mcp(createTaskMCP)
    return await handler(args)
  },
  get_task: async (args: GetTaskArgs) => {
    const handler = payable.mcp(getTaskMCP)
    return await handler(args)
  },
  list_tasks: async (args: ListTasksArgs) => {
    const handler = payable.mcp(listTasksMCP)
    return await handler(args)
  },
  delete_task: async (args: DeleteTaskArgs) => {
    const handler = payable.mcp(deleteTaskMCP)
    return await handler(args)
  },
}

