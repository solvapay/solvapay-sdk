import 'dotenv/config'
import { config } from 'dotenv'
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

// Use z to prevent unused variable error, even if just for type inference
void z

// Load environment variables
config({ path: '.env.local' })
config({ path: '.env' })
import {
  // Task schemas
  TaskSchema,
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  TaskListSchema,
  TaskResponseSchema,
  DeleteTaskResponseSchema,
  PaginationQuerySchema,
  TaskParamsSchema,

  // User schemas
  UserPlanSchema,
  UserInfoSchema,
  UserPlanInfoSchema,

  // Common schemas
  ErrorResponseSchema,
} from '../schemas'

export const registry = new OpenAPIRegistry()

// Register all schemas
registry.register('Task', TaskSchema)
registry.register('CreateTaskRequest', CreateTaskRequestSchema)
registry.register('TaskList', TaskListSchema)
registry.register('TaskResponse', TaskResponseSchema)
registry.register('DeleteTaskResponse', DeleteTaskResponseSchema)
registry.register('UserPlanInfo', UserPlanInfoSchema)
registry.register('UserPlan', UserPlanSchema)
registry.register('UserInfo', UserInfoSchema)
registry.register('ErrorResponse', ErrorResponseSchema)


// User endpoints
registry.registerPath({
  method: 'get',
  path: '/api/user/info',
  operationId: 'getCurrentUser',
  summary: 'Get current user',
  description: 'Get information about the currently authenticated user',
  tags: ['User'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': false,
  responses: {
    200: {
      description: 'User information',
      content: {
        'application/json': {
          schema: UserInfoSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/user/plan',
  operationId: 'getUserPlan',
  summary: 'Get user plan',
  description: 'Get current user subscription plan and usage information',
  tags: ['User'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': false,
  responses: {
    200: {
      description: 'User plan information',
      content: {
        'application/json': {
          schema: UserPlanSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

// Tasks CRUD endpoints - the main functionality for Custom GPT Actions
registry.registerPath({
  method: 'get',
  path: '/api/tasks',
  operationId: 'listTasks',
  summary: 'List tasks',
  description: 'Get a paginated list of tasks for the authenticated user',
  tags: ['Tasks'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': false,
  request: {
    query: PaginationQuerySchema,
  },
  responses: {
    200: {
      description: 'List of tasks',
      content: {
        'application/json': {
          schema: TaskListSchema,
        },
      },
    },
    402: {
      description: 'Payment required - upgrade to pro plan',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'post',
  path: '/api/tasks',
  operationId: 'createTask',
  summary: 'Create task',
  description: 'Create a new task. This endpoint is protected by paywall.',
  tags: ['Tasks'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': true,
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTaskRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Created task',
      content: {
        'application/json': {
          schema: TaskResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request body',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    402: {
      description: 'Payment required - upgrade to pro plan',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/api/tasks/{id}',
  operationId: 'getTask',
  summary: 'Get task',
  description: 'Get a specific task by its unique identifier',
  tags: ['Tasks'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': false,
  request: {
    params: TaskParamsSchema,
  },
  responses: {
    200: {
      description: 'Task details',
      content: {
        'application/json': {
          schema: TaskResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Task not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'put',
  path: '/api/tasks/{id}',
  operationId: 'updateTask',
  summary: 'Update task',
  description: 'Update a specific task (title, description, or completion status). This endpoint is protected by paywall.',
  tags: ['Tasks'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': true,
  request: {
    params: TaskParamsSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateTaskRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated task',
      content: {
        'application/json': {
          schema: TaskResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid request body',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    402: {
      description: 'Payment required - upgrade to pro plan',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Task not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

registry.registerPath({
  method: 'delete',
  path: '/api/tasks/{id}',
  operationId: 'deleteTask',
  summary: 'Delete task',
  description: 'Delete a specific task. This endpoint is protected by paywall.',
  tags: ['Tasks'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': true,
  request: {
    params: TaskParamsSchema,
  },
  responses: {
    200: {
      description: 'Task deleted successfully',
      content: {
        'application/json': {
          schema: DeleteTaskResponseSchema,
        },
      },
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    402: {
      description: 'Payment required - upgrade to pro plan',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Task not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
})

// Export the configured registry for use in the generator
export default registry
