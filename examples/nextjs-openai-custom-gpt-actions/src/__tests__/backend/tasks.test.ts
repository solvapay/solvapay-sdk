import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { writeFileSync, existsSync, unlinkSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { GET as listTasksGET, POST as createTaskPOST } from '../../app/api/tasks/route'
import { GET as getTaskGET, DELETE as deleteTaskDELETE } from '../../app/api/tasks/[id]/route'
import { demoApiClient } from '../../services/apiClient'

describe('Tasks CRUD Endpoints', () => {
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
    
    // Reset usage counters
    await demoApiClient.resetUsage()
  })

  afterEach(async () => {
    // Reset demo data
    await demoApiClient.resetUsage()
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