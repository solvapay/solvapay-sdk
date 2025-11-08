// Set environment variables before importing modules that depend on them
process.env.SOLVAPAY_SECRET_KEY = process.env.SOLVAPAY_SECRET_KEY || 'test-api-key'
process.env.SOLVAPAY_AGENT = process.env.SOLVAPAY_AGENT || 'test-agent'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { setupTestEnvironment } from './test-utils'

// Mock the route module to use stub client
vi.mock('../../app/api/tasks/route', async () => {
  const { createTask, listTasks } = await import('@solvapay/demo-services')
  const { StubSolvaPayClient } = await import('../../../../shared/stub-api-client')
  const { createSolvaPay } = await import('@solvapay/server')
  
  const stubClient = new StubSolvaPayClient({ 
    useFileStorage: true,
    freeTierLimit: 1000,
    debug: false
  })
  const solvaPay = createSolvaPay({ apiClient: stubClient })
  const payable = solvaPay.payable({ agent: 'crud-basic' })
  
  return {
    GET: payable.next(listTasks),
    POST: payable.next(createTask)
  }
})

// Import after mocking
import { GET as listTasksGET, POST as createTaskPOST } from '../../app/api/tasks/route'

describe('Tasks CRUD Endpoints', () => {
  setupTestEnvironment()
  const DEMO_DATA_DIR = join(process.cwd(), '.demo-data')
  const CUSTOMERS_FILE = join(DEMO_DATA_DIR, 'customers.json')

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
      plan: 'pro'
    }
    
    writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2))
  })

  afterEach(async () => {
    // Clean up after tests
  })

  describe('/api/tasks', () => {
    it('should list tasks', async () => {
      const request = new NextRequest('http://localhost:3000/api/tasks', {
        headers: {
          'x-customer-ref': 'demo_user'
        }
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
          'x-customer-ref': 'demo_user'
        },
        body: JSON.stringify({
          title: 'Test Task',
          description: 'A test task for testing'
        })
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