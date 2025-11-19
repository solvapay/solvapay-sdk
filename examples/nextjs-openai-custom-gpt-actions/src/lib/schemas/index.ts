import { z } from 'zod'
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'

// Extend Zod with OpenAPI methods
extendZodWithOpenApi(z)

// Common schemas
export const ErrorResponseSchema = z
  .object({
    error: z.string().describe('Error message'),
    error_description: z.string().optional().describe('Detailed error description'),
  })
  .openapi('ErrorResponse')

export const PaywallErrorResponseSchema = z
  .object({
    error: z.string().describe('Error message'),
    success: z.boolean().describe('Request success status'),
    agent: z.string().describe('The agent that triggered the paywall'),
    checkoutUrl: z.string().describe('URL to upgrade the plan'),
    message: z.string().describe('Human-readable paywall message'),
  })
  .openapi('PaywallErrorResponse')

// Task schemas
export const TaskSchema = z
  .object({
    id: z.string().describe('Unique identifier for the task'),
    title: z.string().describe('Title of the task'),
    description: z.string().optional().describe('Description of the task'),
    completed: z.boolean().describe('Whether the task is completed'),
    createdAt: z.string().datetime().describe('Creation timestamp'),
    updatedAt: z.string().datetime().describe('Last update timestamp'),
  })
  .openapi('Task')

export const CreateTaskRequestSchema = z
  .object({
    title: z.string().min(1).describe('Title of the task to create'),
    description: z.string().optional().describe('Optional description of the task'),
  })
  .openapi('CreateTaskRequest')

export const TaskListSchema = z
  .object({
    tasks: z.array(TaskSchema).describe('Array of tasks'),
    total: z.number().describe('Total number of tasks available'),
    limit: z.number().describe('Number of items per page'),
    offset: z.number().describe('Number of items skipped'),
  })
  .openapi('TaskList')

// Query parameter schemas
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(10).describe('Number of items to return'),
  offset: z.coerce.number().min(0).default(0).describe('Number of items to skip'),
})

export const TaskParamsSchema = z.object({
  id: z.string().describe('The unique identifier of the task'),
})

// User Plan schemas
export const UserPlanSchema = z
  .object({
    plan: z.enum(['free', 'pro']).describe('Current subscription plan'),
    usage: z
      .object({
        api_calls: z.number().describe('Number of API calls made'),
        last_reset: z.string().datetime().describe('Last usage reset timestamp'),
      })
      .describe('Current usage statistics'),
    limits: z
      .object({
        api_calls: z.number().describe('Maximum API calls allowed'),
        reset_period: z.string().describe('Usage reset period'),
      })
      .describe('Plan limits'),
    upgradedAt: z.string().datetime().optional().describe('Timestamp when plan was upgraded'),
  })
  .openapi('UserPlan')

// Type exports for use in API routes
export type Task = z.infer<typeof TaskSchema>
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>
export type TaskList = z.infer<typeof TaskListSchema>
export type UserPlan = z.infer<typeof UserPlanSchema>
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
