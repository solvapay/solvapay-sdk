// Set environment variables before importing modules that depend on them
process.env.SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY || 'test-api-key'
process.env.SOLVAPAY_AGENT = process.env.SOLVAPAY_AGENT || 'test-agent'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { setupTestEnvironment } from './test-utils'

// Mock Supabase client before importing anything that uses it
const mockTasksData = [] as any[]

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'tasks') {
        return {
          insert: vi.fn((data: any) => ({
            select: vi.fn(() => ({
              single: vi.fn(() => {
                const task = {
                  id: `task-${Date.now()}`,
                  title: data.title,
                  description: data.description || null,
                  completed: false,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                  user_id: data.user_id,
                }
                mockTasksData.push(task)
                return Promise.resolve({ data: task, error: null })
              }),
            })),
          })),
          select: vi.fn((columns: string, options?: any) => {
            // Handle count query
            if (options?.count === 'exact') {
              return {
                eq: vi.fn((col: string, val: any) => {
                  const filteredTasks = mockTasksData.filter(t => t[col] === val)
                  return Promise.resolve({ count: filteredTasks.length, error: null })
                }),
              }
            }
            
            // Handle regular select
            if (columns === '*') {
              return {
                range: vi.fn(() => ({
                  order: vi.fn(() => ({
                    eq: vi.fn((col: string, val: any) => {
                      const filteredTasks = mockTasksData.filter(t => t[col] === val)
                      return Promise.resolve({ data: filteredTasks, error: null })
                    }),
                  })),
                })),
                eq: vi.fn((col: string, val: any) => ({
                  eq: vi.fn((col2: string, val2: any) => {
                    const filteredTasks = mockTasksData.filter(t => t[col] === val && (!col2 || t[col2] === val2))
                    return Promise.resolve({ data: filteredTasks, error: null })
                  }),
                })),
              }
            }
            
            return {}
          }),
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
        next: vi.fn((handler: any, options?: any) => {
          // Return a wrapper that calls the handler directly without paywall checks
          return async (req: Request, context?: any) => {
            try {
              // Extract args if provided
              let args = {}
              if (options?.extractArgs) {
                args = await options.extractArgs(req)
              }
              
              // Call the handler directly
              const result = await handler(args)
              
              // Return as NextResponse
              return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            } catch (error: any) {
              return new Response(
                JSON.stringify({ error: error.message }),
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

describe('Tasks CRUD Endpoints', () => {
  setupTestEnvironment()

  beforeEach(async () => {
    vi.clearAllMocks()
    mockTasksData.length = 0 // Clear the mock data
  })

  describe('/api/tasks', () => {
    it('should list tasks', async () => {
      const request = new NextRequest('http://localhost:3000/api/tasks', {
        headers: {
          'x-user-id': 'test-user-id',
        },
      })

      const response = await listTasksGET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.tasks).toBeDefined()
      expect(Array.isArray(data.tasks)).toBe(true)
    })

    it('should create a new task', async () => {
      const request = new NextRequest('http://localhost:3000/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'test-user-id',
        },
        body: JSON.stringify({
          title: 'Test Task',
          description: 'A test task for testing',
        }),
      })

      const response = await createTaskPOST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.task).toBeDefined()
      expect(data.task.title).toBe('Test Task')
    })
  })
})
