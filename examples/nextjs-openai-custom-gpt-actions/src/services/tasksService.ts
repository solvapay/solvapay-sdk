import { supabase as defaultSupabase } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

// Helper to get appropriate Supabase client
function getSupabase() {
  // If we have a service role key, use it to bypass RLS (server-side)
  // This is necessary for custom OAuth flows where we don't have a Supabase session
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  }
  return defaultSupabase
}

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
  const { title, description } = args
  
  // Determine user ID
  // 1. Explicit userId (from Custom OAuth middleware)
  // 2. SolvaPay auth context
  let targetUserId = args.userId
  if (!targetUserId && args.auth?.customer_ref) {
    targetUserId = args.auth.customer_ref
  }

  if (!title) {
    throw new Error('Title is required')
  }

  const supabase = getSupabase()
  
  // If using service role (implied by getSupabase returning a new client),
  // we must ensure we have a user ID to assign ownership.
  // If using default client (anon key), RLS will handle it (uses auth.uid())
  // BUT: `insert` with RLS requires the user to be authenticated.
  
  // Construct query
  const query = supabase.from('tasks').insert({
    title,
    description,
    // If we have an explicit targetUserId, use it.
    // This works with Service Role (bypasses RLS).
    // If using Anon Key + RLS, 'user_id' column is usually set automatically by default 
    // or triggers, OR we set it here and RLS ensures it matches auth.uid().
    ...(targetUserId ? { user_id: targetUserId } : {})
  })

  const { data, error } = await query.select().single()

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
  userId?: string
}): Promise<{ success: boolean; task: Task }> {
  const { id, userId } = args
  const targetUserId = userId || args.auth?.customer_ref

  const supabase = getSupabase()
  
  let query = supabase.from('tasks').select('*').eq('id', id)
  
  // Enforce ownership if we have a target user (Service Role usage)
  if (targetUserId) {
    query = query.eq('user_id', targetUserId)
  }

  const { data, error } = await query.single()

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
  userId?: string
}): Promise<{ success: boolean; tasks: Task[]; total: number; limit: number; offset: number }> {
  const { limit = 10, offset = 0, userId } = args
  const targetUserId = userId || args.auth?.customer_ref

  const supabase = getSupabase()

  // Start building query
  let countQuery = supabase.from('tasks').select('*', { count: 'exact', head: true })
  
  // If we are using service role (implied by passing userId), we MUST filter by user_id
  // otherwise we list everyone's tasks.
  if (targetUserId) {
    countQuery = countQuery.eq('user_id', targetUserId)
  }

  const { count, error: countError } = await countQuery

  if (countError) {
    console.error('Count error details:', JSON.stringify(countError, null, 2))
    throw new Error(`Failed to count tasks: ${countError.message}`)
  }

  // Data query
  let dataQuery = supabase
    .from('tasks')
    .select('*')
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })
    
  if (targetUserId) {
    dataQuery = dataQuery.eq('user_id', targetUserId)
  }

  const { data, error } = await dataQuery

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
 * Update a task by ID
 */
export async function updateTask(args: {
  id: string
  title?: string
  description?: string
  completed?: boolean
  auth?: { customer_ref?: string }
  userId?: string
}): Promise<{ success: boolean; task: Task }> {
  const { id, userId, title, description, completed } = args
  const targetUserId = userId || args.auth?.customer_ref

  const supabase = getSupabase()

  // Build update object with only provided fields
  const updates: Record<string, unknown> = {}
  if (title !== undefined) updates.title = title
  if (description !== undefined) updates.description = description
  if (completed !== undefined) updates.completed = completed
  
  // Always update the updated_at timestamp
  updates.updated_at = new Date().toISOString()

  if (Object.keys(updates).length === 1) {
    // Only updated_at was set, nothing else to update
    throw new Error('No fields to update')
  }

  // Update query
  let query = supabase.from('tasks').update(updates).eq('id', id)
  
  // Enforce ownership if we have a target user (Service Role usage)
  if (targetUserId) {
    query = query.eq('user_id', targetUserId)
  }

  const { data, error } = await query.select().single()

  if (error) {
    console.error('Error updating task:', error)
    throw new Error(`Failed to update task: ${error.message}`)
  }

  return {
    success: true,
    task: mapTask(data),
  }
}

/**
 * Delete a task by ID
 */
export async function deleteTask(args: {
  id: string
  auth?: { customer_ref?: string }
  userId?: string
}): Promise<{ success: boolean; message: string; deletedTask: Task }> {
  const { id, userId } = args
  const targetUserId = userId || args.auth?.customer_ref

  const supabase = getSupabase()

  // Get task first to return it (and verify ownership)
  let getQuery = supabase.from('tasks').select('*').eq('id', id)
  if (targetUserId) {
    getQuery = getQuery.eq('user_id', targetUserId)
  }
  
  const { data: taskData, error: getError } = await getQuery.single()

  if (getError) {
    throw new Error('Task not found')
  }

  // Delete
  let deleteQuery = supabase.from('tasks').delete().eq('id', id)
  if (targetUserId) {
    deleteQuery = deleteQuery.eq('user_id', targetUserId)
  }

  const { error } = await deleteQuery

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
  if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'development') {
    throw new Error('Clear all tasks is only available in test/dev environments')
  }
  
  // Use default supabase client (usually has RLS or needs admin key)
  // For tests, we often want to clear everything, so use getSupabase()
  await getSupabase().from('tasks').delete().neq('id', '00000000-0000-0000-0000-000000000000')
}
