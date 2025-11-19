import { supabase } from '@/lib/supabase'

export interface Task {
  id: string
  title: string
  description?: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Map Supabase row to Task interface
 */
function mapTask(row: {
  id: string
  title: string
  description?: string
  completed: boolean
  created_at: string
  updated_at: string
}): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    completed: row.completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Create a new task
 */
export async function createTask(args: {
  title: string
  description?: string
  auth?: { customer_ref?: string } // Keep for SolvaPay compatibility
  userId?: string
}): Promise<{ success: boolean; task: Task }> {
  const { title, description, userId } = args

  if (!title) {
    throw new Error('Title is required')
  }

  // If we have a userId passed (e.g. from SolvaPay context), use it
  // Otherwise, try to get it from the current session (for direct calls)
  let targetUserId = userId
  if (!targetUserId && args.auth?.customer_ref) {
    targetUserId = args.auth.customer_ref
  }

  // In a real server-side context with RLS, we might rely on the auth context.
  // But since we're using the service role or authenticated client, we need to ensure we have the user ID.
  // For this demo, we assume the Supabase client is already scoped or we pass the ID.
  
  // NOTE: When using SolvaPay's `payable`, the `auth` object is populated from the request headers.
  // However, SolvaPay server-side execution might not have the Supabase session context unless we forward it.
  // For this demo, we'll use the authenticated client if available, or rely on RLS.

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title,
      description,
      user_id: targetUserId, // Explicitly set if using service role, or let RLS handle if using auth client
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating task:', error)
    throw new Error(`Failed to create task: ${error.message}`)
  }

  return {
    success: true,
    task: mapTask(data),
  }
}

/**
 * Get a task by ID
 */
export async function getTask(args: {
  id: string
  auth?: { customer_ref?: string }
}): Promise<{ success: boolean; task: Task }> {
  const { id } = args

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    throw new Error('Task not found')
  }

  return {
    success: true,
    task: mapTask(data),
  }
}

/**
 * List all tasks with pagination
 */
export async function listTasks(args: {
  limit?: number
  offset?: number
  auth?: { customer_ref?: string }
}): Promise<{ success: boolean; tasks: Task[]; total: number; limit: number; offset: number }> {
  const { limit = 10, offset = 0 } = args

  // Get total count
  const { count, error: countError } = await supabase
    .from('tasks')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    throw new Error(`Failed to count tasks: ${countError.message}`)
  }

  // Get paginated data
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to list tasks: ${error.message}`)
  }

  return {
    success: true,
    tasks: data.map(mapTask),
    total: count || 0,
    limit,
    offset,
  }
}

/**
 * Delete a task by ID
 */
export async function deleteTask(args: {
  id: string
  auth?: { customer_ref?: string }
}): Promise<{ success: boolean; message: string; deletedTask: Task }> {
  const { id } = args

  // Get task first to return it
  const { data: taskData, error: getError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single()

  if (getError) {
    throw new Error('Task not found')
  }

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)

  if (error) {
    throw new Error(`Failed to delete task: ${error.message}`)
  }

  return {
    success: true,
    message: 'Task deleted successfully',
    deletedTask: mapTask(taskData),
  }
}

/**
 * Clear all tasks (utility function for testing - careful!)
 */
export async function clearAllTasks(): Promise<void> {
  // This should probably only be allowed in test environments
  if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'development') {
    throw new Error('Clear all tasks is only available in test/dev environments')
  }
  
  await supabase.from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000')
}
