// Set environment variables before importing modules that depend on them
process.env.SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY || 'test-api-key'
process.env.SOLVAPAY_PRODUCT = process.env.SOLVAPAY_PRODUCT || 'test-product'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { setupTestEnvironment } from './test-utils'

// Mock Supabase client before importing anything that uses it
interface MockTask {
  id: string
  title: string
  description: string | null
  completed: boolean
  created_at: string
  updated_at: string
  user_id: string
}

const mockTasksStore = {
  tasks: [] as MockTask[],
  nextId: 1,
}

// Helper to create a query builder that tracks filters
function createQueryBuilder(filters: Record<string, unknown> = {}) {
  return {
    eq: (col: string, val: unknown) => createQueryBuilder({ ...filters, [col]: val }),
    single: () => {
      const task = mockTasksStore.tasks.find(t => 
        Object.entries(filters).every(([key, value]) => t[key] === value)
      )
      return Promise.resolve({
        data: task,
        error: task ? null : { message: 'Not found' }
      })
    },
    range: (start: number, end: number) => createRangeBuilder(filters, start, end),
  }
}

function createRangeBuilder(filters: Record<string, unknown>, _start: number, _end: number) {
  return {
    order: (_col: string, _opts?: unknown) => ({
      eq: (col2: string, val2: unknown) => {
        const allFilters = { ...filters, [col2]: val2 }
        const tasks = mockTasksStore.tasks.filter(t =>
          Object.entries(allFilters).every(([key, value]) => t[key] === value)
        )
        return Promise.resolve({ data: tasks, error: null })
      },
    }),
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'tasks') {
        return {
          insert: vi.fn((data: Partial<MockTask> & { title: string; user_id: string }) => ({
            select: vi.fn(() => ({
              single: vi.fn(() => {
                const task = {
                  id: `task-${mockTasksStore.nextId++}`,
                  title: data.title,
                  description: data.description || null,
                  completed: false,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  user_id: data.user_id,
                }
                mockTasksStore.tasks.push(task)
                return Promise.resolve({ data: task, error: null })
              }),
            })),
          })),
          select: vi.fn((columns: string, options?: { count?: string }) => {
            // Handle count query
            if (options?.count === 'exact') {
              return {
                eq: vi.fn((col: string, val: unknown) => {
                  const filteredTasks = mockTasksStore.tasks.filter(t => t[col] === val)
                  return Promise.resolve({ count: filteredTasks.length, error: null })
                }),
              }
            }
            
            // Handle regular select - return query builder
            if (columns === '*') {
              return createQueryBuilder()
            }
            
            return {}
          }),
          delete: vi.fn(() => ({
            eq: vi.fn((col: string, val: unknown) => {
              const filters = { [col]: val }
              return {
                eq: vi.fn((col2: string, val2: unknown) => {
                  const allFilters = { ...filters, [col2]: val2 }
                  const index = mockTasksStore.tasks.findIndex(t =>
                    Object.entries(allFilters).every(([key, value]) => t[key] === value)
                  )
                  if (index !== -1) {
                    mockTasksStore.tasks.splice(index, 1)
                  }
                  return Promise.resolve({ error: null })
                }),
              }
            }),
          })),
        }
      }
      return {}
    }),
  })),
}))

// Mock the supabase lib
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({})),
  },
}))

// Mock the @solvapay/server package to avoid real API calls
vi.mock('@solvapay/server', async () => {
  const actual = await vi.importActual('@solvapay/server')
  return {
    ...actual,
    createSolvaPay: vi.fn(() => ({
      payable: vi.fn(() => ({
        next: vi.fn((handler: (args: unknown) => Promise<unknown>, options?: { extractArgs?: (req: Request, context?: unknown) => Promise<unknown> }) => {
          // Return a wrapper that calls the handler directly without paywall checks
          return async (req: Request, _context?: unknown) => {
            try {
              // Extract args if provided
              let args: unknown = {}
              if (options?.extractArgs) {
                args = await options.extractArgs(req, _context)
              }
              
              // Call the handler directly
              const result = await handler(args)
              
              // Return as NextResponse
              return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            } catch (error: unknown) {
              return new Response(
                JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
              )
            }
          }
        }),
      })),
    })),
  }
})

// Import after mocking
import { GET as listTasksGET, POST as createTaskPOST } from '../../app/api/tasks/route'
import { GET as getTaskGET, DELETE as deleteTaskDELETE } from '../../app/api/tasks/[id]/route'

describe('Integration Tests', () => {
  setupTestEnvironment()

  beforeEach(async () => {
    vi.clearAllMocks()
    // Clear the mock store
    mockTasksStore.tasks = []
    mockTasksStore.nextId = 1
  })

  describe('Complete User Journey', () => {
    it('should handle complete user journey from task CRUD operations', async () => {
      const userId = 'test-user-id'

      // 1. Create a task
      const createRequest = new NextRequest('http://localhost:3000/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
        },
        body: JSON.stringify({
          title: 'Integration Test Task',
          description: 'A task created during integration test',
        }),
      })

      const createResponse = await createTaskPOST(createRequest)
      const createData = await createResponse.json()
      expect(createResponse.status).toBe(200)
      expect(createData.success).toBe(true)
      expect(createData.task).toBeDefined()
      expect(createData.task.title).toBe('Integration Test Task')

      // Extract task ID from response
      const taskId = createData.task.id

      // 2. List tasks
      const listRequest = new NextRequest('http://localhost:3000/api/tasks', {
        headers: {
          'x-user-id': userId,
        },
      })

      const listResponse = await listTasksGET(listRequest)
      const listData = await listResponse.json()
      expect(listResponse.status).toBe(200)
      expect(listData.success).toBe(true)
      expect(listData.tasks).toBeDefined()
      expect(Array.isArray(listData.tasks)).toBe(true)
      expect(listData.tasks.length).toBeGreaterThan(0)

      // 3. Get specific task
      const getRequest = new NextRequest(`http://localhost:3000/api/tasks/${taskId}`, {
        headers: {
          'x-user-id': userId,
        },
      })

      const getResponse = await getTaskGET(getRequest, { params: Promise.resolve({ id: taskId }) })
      const getData = await getResponse.json()
      expect(getResponse.status).toBe(200)
      expect(getData.success).toBe(true)
      expect(getData.task).toBeDefined()
      expect(getData.task.title).toBe('Integration Test Task')
      expect(getData.task.id).toBe(taskId)

      // 4. Delete task
      const deleteRequest = new NextRequest(`http://localhost:3000/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: {
          'x-user-id': userId,
        },
      })

      const deleteResponse = await deleteTaskDELETE(deleteRequest, {
        params: Promise.resolve({ id: taskId }),
      })
      const deleteData = await deleteResponse.json()
      expect(deleteResponse.status).toBe(200)
      expect(deleteData.success).toBe(true)
      expect(deleteData.message).toBe('Task deleted successfully')
      expect(deleteData.deletedTask).toBeDefined()
      expect(deleteData.deletedTask.id).toBe(taskId)
    })
  })
})
