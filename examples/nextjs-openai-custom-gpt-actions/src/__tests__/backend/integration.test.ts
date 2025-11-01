import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GET as healthGET } from '../../app/api/health/route'
import { GET as listTasksGET, POST as createTaskPOST } from '../../app/api/tasks/route'
import { GET as getTaskGET, DELETE as deleteTaskDELETE } from '../../app/api/tasks/[id]/route'
import { GET as userPlanGET } from '../../app/api/user/plan/route'
import { POST as updatePlanPOST } from '../../app/api/user/plan/update/route'
import { SignJWT } from 'jose'
import { writeFileSync, existsSync, unlinkSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'
import { demoApiClient } from '../../services/apiClient'
import { clearAllTasks } from '@solvapay/demo-services'

describe('Integration Tests', () => {
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
      plan: 'pro'
    }
    
    writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2))
    
    // Clean up user plans file
    if (existsSync(USER_PLANS_FILE)) {
      unlinkSync(USER_PLANS_FILE)
    }
    
    // Reset usage and clear all tasks
    await demoApiClient.resetUsage()
    clearAllTasks()
  })

  afterEach(async () => {
    // Clean up after tests
    await demoApiClient.resetUsage()
    clearAllTasks()
  })

  describe('Complete User Journey', () => {
    it('should handle complete user journey from health check to task CRUD operations', async () => {
      // 1. Health check
      const healthRequest = new NextRequest('http://localhost:3000/api/health')
      const healthResponse = await healthGET(healthRequest)
      expect(healthResponse.status).toBe(200)

      // Ensure demo_user has pro plan
      const proPlans = {
        'demo_user': {
          plan: 'pro',
          upgradedAt: new Date().toISOString()
        }
      }
      writeFileSync(USER_PLANS_FILE, JSON.stringify(proPlans, null, 2))

      // 2. Create a task
      const createRequest = new NextRequest('http://localhost:3000/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-customer-ref': 'demo_user'
        },
        body: JSON.stringify({
          title: 'Integration Test Task',
          description: 'A task created during integration test'
        })
      })

      const createResponse = await createTaskPOST(createRequest)
      const createData = await createResponse.json()
      expect(createResponse.status).toBe(200)
      expect(createData.success).toBe(true)
      expect(createData.task).toBeDefined()
      expect(createData.task.title).toBe('Integration Test Task')

      // Extract task ID from response
      const taskId = createData.task.id

      // 3. List tasks
      const listRequest = new NextRequest('http://localhost:3000/api/tasks', {
        headers: {
          'x-customer-ref': 'demo_user'
        }
      })

      const listResponse = await listTasksGET(listRequest)
      const listData = await listResponse.json()
      expect(listResponse.status).toBe(200)
      expect(listData.success).toBe(true)
      expect(listData.tasks).toBeDefined()
      expect(Array.isArray(listData.tasks)).toBe(true)
      expect(listData.tasks.length).toBeGreaterThan(0)

      // 4. Get specific task
      const getRequest = new NextRequest(`http://localhost:3000/api/tasks/${taskId}`, {
        headers: {
          'x-customer-ref': 'demo_user'
        }
      })

      const getResponse = await getTaskGET(getRequest, { params: Promise.resolve({ id: taskId }) })
      const getData = await getResponse.json()
      expect(getResponse.status).toBe(200)
      expect(getData.success).toBe(true)
      expect(getData.task).toBeDefined()
      expect(getData.task.title).toBe('Integration Test Task')
      expect(getData.task.id).toBe(taskId)

      // 5. Delete task
      const deleteRequest = new NextRequest(`http://localhost:3000/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: {
          'x-customer-ref': 'demo_user'
        }
      })

      const deleteResponse = await deleteTaskDELETE(deleteRequest, { params: Promise.resolve({ id: taskId }) })
      const deleteData = await deleteResponse.json()
      expect(deleteResponse.status).toBe(200)
      expect(deleteData.success).toBe(true)
      expect(deleteData.message).toBe('Task deleted successfully')
      expect(deleteData.deletedTask).toBeDefined()
      expect(deleteData.deletedTask.id).toBe(taskId)
    })
  })
})
