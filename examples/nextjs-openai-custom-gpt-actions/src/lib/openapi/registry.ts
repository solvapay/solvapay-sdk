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
  TaskListSchema,
  PaginationQuerySchema,
  TaskParamsSchema,

  // User schemas
  UserPlanSchema,
  UserInfoSchema,
  SignOutResponseSchema,

  // Common schemas
  ErrorResponseSchema,
} from '../schemas'

export const registry = new OpenAPIRegistry()

// Register all schemas
registry.register('Task', TaskSchema)
registry.register('CreateTaskRequest', CreateTaskRequestSchema)
registry.register('TaskList', TaskListSchema)
registry.register('UserPlan', UserPlanSchema)
registry.register('UserInfo', UserInfoSchema)
registry.register('SignOutResponse', SignOutResponseSchema)
registry.register('ErrorResponse', ErrorResponseSchema)

// Security scheme for OAuth - support multiple URL sources
// Priority: PUBLIC_URL > VERCEL_URL (auto-detected on Vercel)
let baseUrl = process.env.PUBLIC_URL

// If running on Vercel and no explicit URL is set, use VERCEL_URL
if (!baseUrl && process.env.VERCEL_URL) {
  baseUrl = `https://${process.env.VERCEL_URL}`
}

// Use placeholder only during build if no URL is available
// The actual OpenAPI spec generation will validate and use proper URLs
if (!baseUrl) {
  console.warn(
    '⚠️  [OpenAPI Registry] No URL configured, using placeholder. Set PUBLIC_URL for production.',
  )
  baseUrl = 'https://placeholder.example.com'
}

// Reject user-provided placeholder URLs
if (
  process.env.PUBLIC_URL &&
  (baseUrl.includes('your-domain') || baseUrl.includes('your-subdomain'))
) {
  throw new Error(
    `Invalid environment variable value: ${baseUrl}. Cannot use placeholder URLs like "your-domain" or "your-subdomain". Please set a real URL.`,
  )
}

// Use generic OAuth2 security scheme pointing to standard OAuth endpoints
// Get Supabase URL from environment
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL

if (!supabaseUrl) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL environment variable is required for OAuth configuration',
  )
}

registry.registerComponent('securitySchemes', 'oauth2', {
  type: 'oauth2',
  flows: {
    authorizationCode: {
      authorizationUrl: `${baseUrl}/api/oauth/authorize`,
      tokenUrl: `${baseUrl}/api/oauth/token`,
      scopes: {
        // Default Supabase scopes (optional to list here, but good for docs)
        email: 'Access to email address',
        phone: 'Access to phone number',
        openid: 'OpenID Connect support',
        profile: 'Access to user profile',
      },
    },
  },
})

// User endpoints
registry.registerPath({
  method: 'get',
  path: '/api/me',
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
  method: 'post',
  path: '/api/auth/signout',
  operationId: 'signOut',
  summary: 'Sign out',
  description: 'Sign out the current user and revoke their session. The GPT will need to re-authenticate on the next action.',
  tags: ['Auth'],
  security: [{ oauth2: [] }],
  'x-openai-isConsequential': true,
  responses: {
    200: {
      description: 'Successfully signed out',
      content: {
        'application/json': {
          schema: SignOutResponseSchema,
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
          schema: TaskSchema,
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
          schema: TaskSchema,
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
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
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
