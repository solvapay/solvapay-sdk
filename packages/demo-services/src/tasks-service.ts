/**
 * Shared Tasks Service
 * 
 * A simple in-memory CRUD service for managing tasks.
 * This is a demo implementation used across all examples.
 * 
 * Features:
 * - In-memory task storage
 * - CRUD operations (Create, Read, List, Delete)
 * - Paywall integration support via auth parameter
 * - Task completion tracking
 */

export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

// In-memory task storage
const tasks = new Map<string, Task>();
let nextId = 1;

/**
 * Create a new task
 */
export async function createTask(args: { 
  title: string; 
  description?: string;
  auth?: { customer_ref?: string };
}): Promise<{ success: boolean; task: Task }> {
  const { title, description } = args;
  
  if (!title) {
    throw new Error('Title is required');
  }

  const id = `task_${nextId++}`;
  const now = new Date().toISOString();
  
  const task: Task = {
    id,
    title,
    description,
    completed: false,
    createdAt: now,
    updatedAt: now
  };
  
  tasks.set(id, task);
  
  return {
    success: true,
    task
  };
}

/**
 * Get a task by ID
 */
export async function getTask(args: { 
  id: string;
  auth?: { customer_ref?: string };
}): Promise<{ success: boolean; task: Task }> {
  const { id } = args;
  
  const task = tasks.get(id);
  
  if (!task) {
    throw new Error('Task not found');
  }
  
  return {
    success: true,
    task
  };
}

/**
 * List all tasks with pagination
 */
export async function listTasks(args: { 
  limit?: number;
  offset?: number;
  auth?: { customer_ref?: string };
}): Promise<{ success: boolean; tasks: Task[]; total: number; limit: number; offset: number }> {
  const { limit = 10, offset = 0 } = args;
  
  const allTasks = Array.from(tasks.values());
  const paginatedTasks = allTasks.slice(offset, offset + limit);
  
  return {
    success: true,
    tasks: paginatedTasks,
    total: allTasks.length,
    limit,
    offset
  };
}

/**
 * Delete a task by ID
 */
export async function deleteTask(args: { 
  id: string;
  auth?: { customer_ref?: string };
}): Promise<{ success: boolean; message: string; deletedTask: Task }> {
  const { id } = args;
  
  const task = tasks.get(id);
  
  if (!task) {
    throw new Error('Task not found');
  }
  
  tasks.delete(id);
  
  return {
    success: true,
    message: 'Task deleted successfully',
    deletedTask: task
  };
}

/**
 * Get the total number of tasks (utility function)
 */
export function getTaskCount(): number {
  return tasks.size;
}

/**
 * Clear all tasks (utility function for testing)
 */
export function clearAllTasks(): void {
  tasks.clear();
  nextId = 1;
}

