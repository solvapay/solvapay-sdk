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
    product: z.string().describe('The product that triggered the paywall'),
    checkoutUrl: z.string().describe('URL to upgrade'),
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

export const UpdateTaskRequestSchema = z
  .object({
    title: z.string().min(1).optional().describe('Updated title of the task'),
    description: z.string().optional().describe('Updated description of the task'),
    completed: z.boolean().optional().describe('Updated completion status of the task'),
  })
  .openapi('UpdateTaskRequest')

export const TaskListSchema = z
  .object({
    success: z.boolean().describe('Whether the request was successful'),
    tasks: z.array(TaskSchema).describe('Array of tasks'),
    total: z.number().describe('Total number of tasks available'),
    limit: z.number().describe('Number of items per page'),
    offset: z.number().describe('Number of items skipped'),
  })
  .openapi('TaskList')

// Task response schemas with success wrapper
export const TaskResponseSchema = z
  .object({
    success: z.boolean().describe('Whether the request was successful'),
    task: TaskSchema.describe('The task object'),
  })
  .openapi('TaskResponse')

export const DeleteTaskResponseSchema = z
  .object({
    success: z.boolean().describe('Whether the request was successful'),
    message: z.string().describe('Success message'),
    deletedTask: TaskSchema.describe('The deleted task object'),
  })
  .openapi('DeleteTaskResponse')

// Query parameter schemas
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(10).describe('Number of items to return'),
  offset: z.coerce.number().min(0).default(0).describe('Number of items to skip'),
})

export const TaskParamsSchema = z.object({
  id: z.string().describe('The unique identifier of the task'),
})

// Simplified subscription info schema for OpenAPI (exposes only what users need to know)
export const UserSubscriptionInfoSchema = z
  .object({
    productName: z.string().describe('Product name'),
    status: z.enum(['pending', 'active', 'expired', 'cancelled', 'suspended', 'refunded']).describe('Purchase status'),
    isActive: z.boolean().describe('Whether the subscription is currently active (status is active or trialing)'),
  })
  .openapi('UserSubscriptionInfo')

/** @deprecated Use UserSubscriptionInfoSchema instead */
export const UserPlanInfoSchema = UserSubscriptionInfoSchema

// User subscription schema (for /api/user/subscription endpoint)
export const UserSubscriptionSchema = z
  .object({
    subscription: UserSubscriptionInfoSchema.nullable().describe('Active subscription information, or null if user has no active subscription'),
    customer: z.object({
      customerRef: z.string().describe('Customer reference identifier'),
      email: z.string().optional().describe('Customer email'),
      externalRef: z.string().optional().describe('External reference (e.g., Supabase user ID)'),
    }).optional().describe('Customer information (not present on error)'),
    error: z.string().optional().describe('Error message if request failed'),
  })
  .openapi('UserSubscription')

/** @deprecated Use UserSubscriptionSchema instead */
export const UserPlanSchema = UserSubscriptionSchema

// User Info schema (for /api/user/info endpoint)
export const UserInfoSchema = z
  .object({
    authenticated: z.boolean().describe('Whether the user is authenticated'),
    user: z.object({
      id: z.string().describe('User unique identifier'),
      email: z.string().email().optional().describe('User email address'),
      name: z.string().optional().describe('User name'),
    }).optional().describe('User information'),
    error: z.string().optional().describe('Error message if authentication failed'),
  })
  .openapi('UserInfo')

// Type exports for use in API routes
export type Task = z.infer<typeof TaskSchema>
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>
export type TaskList = z.infer<typeof TaskListSchema>
export type TaskResponse = z.infer<typeof TaskResponseSchema>
export type DeleteTaskResponse = z.infer<typeof DeleteTaskResponseSchema>
export type UserSubscriptionInfo = z.infer<typeof UserSubscriptionInfoSchema>
export type UserSubscription = z.infer<typeof UserSubscriptionSchema>
/** @deprecated */
export type UserPlanInfo = UserSubscriptionInfo
/** @deprecated */
export type UserPlan = UserSubscription
export type UserInfo = z.infer<typeof UserInfoSchema>
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
