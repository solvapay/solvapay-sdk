// Set environment variables before importing modules that depend on them
process.env.SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY || 'test-api-key'
process.env.SOLVAPAY_AGENT = process.env.SOLVAPAY_AGENT || 'test-agent'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, existsSync, unlinkSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'
import { clearAllTasks } from '@solvapay/demo-services'
import { setupTestEnvironment } from './test-utils'

// Mock the route modules to use stub client
vi.mock('../../app/api/tasks/route', async () => {
  const { createTask, listTasks } = await import('@solvapay/demo-services')
  const { StubSolvaPayClient } = await import('../../../../shared/stub-api-client')
  const { createSolvaPay } = await import('@solvapay/server')

  const stubClient = new StubSolvaPayClient({
    useFileStorage: true,
    freeTierLimit: 1000,
    debug: false,
  })
  const solvaPay = createSolvaPay({ apiClient: stubClient })
  const payable = solvaPay.payable({ agent: 'crud-basic' })

  return {
    GET: payable.next(listTasks),
    POST: payable.next(createTask),
  }
})

vi.mock('../../app/api/tasks/[id]/route', async () => {
  const { getTask, deleteTask } = await import('@solvapay/demo-services')
  const { StubSolvaPayClient } = await import('../../../../shared/stub-api-client')
  const { createSolvaPay } = await import('@solvapay/server')

  const stubClient = new StubSolvaPayClient({
    useFileStorage: true,
    freeTierLimit: 1000,
    debug: false,
  })
  const solvaPay = createSolvaPay({ apiClient: stubClient })
  const payable = solvaPay.payable({ agent: 'crud-basic' })

  return {
    GET: payable.next(getTask),
    DELETE: payable.next(deleteTask),
  }
})

// Import after mocking
import { GET as listTasksGET, POST as createTaskPOST } from '../../app/api/tasks/route'
import { GET as getTaskGET, DELETE as deleteTaskDELETE } from '../../app/api/tasks/[id]/route'

describe('Integration Tests', () => {
  setupTestEnvironment()
  const DEMO_DATA_DIR = join(process.cwd(), '.demo-data')
  const CUSTOMERS_FILE = join(DEMO_DATA_DIR, 'customers.json')
  const USER_PLANS_FILE = join(process.cwd(), 'user-plans.json')

  beforeEach(async () => {
    // Ensure demo data directory exists
    if (!existsSync(DEMO_DATA_DIR)) {
      mkdirSync(DEMO_DATA_DIR, { recursive: true })
    }

    // Set up test customers with pro plans
    const customers = existsSync(CUSTOMERS_FILE)
      ? JSON.parse(readFileSync(CUSTOMERS_FILE, 'utf-8'))
      : {}

    customers['demo_user'] = {
      credits: 100,
      email: 'demo@example.com',
      name: 'Demo User',
      plan: 'pro',
    }

    writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2))

    // Clean up user plans file
    if (existsSync(USER_PLANS_FILE)) {
      unlinkSync(USER_PLANS_FILE)
    }

    // Clear all tasks
    clearAllTasks()
  })

  afterEach(async () => {
    // Clean up after tests
    clearAllTasks()
  })

  describe('Complete User Journey', () => {
    it('should handle complete user journey from task CRUD operations', async () => {
      // Ensure demo_user has pro plan
      const proPlans = {
        demo_user: {
          plan: 'pro',
          upgradedAt: new Date().toISOString(),
        },
      }
      writeFileSync(USER_PLANS_FILE, JSON.stringify(proPlans, null, 2))

      // 1. Create a task
      const createRequest = new NextRequest('http://localhost:3000/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-customer-ref': 'demo_user',
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
          'x-customer-ref': 'demo_user',
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
          'x-customer-ref': 'demo_user',
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
          'x-customer-ref': 'demo_user',
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
