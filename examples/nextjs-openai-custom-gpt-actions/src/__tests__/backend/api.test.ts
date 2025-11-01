import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as healthGET } from '../../app/api/health/route'
import { GET as healthzGET } from '../../app/api/healthz/route'

describe('Health Endpoints', () => {
  describe('/api/health', () => {
    it('should return health status', async () => {
      const request = new NextRequest('http://localhost:3000/api/health')
      const response = await healthGET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.status).toBe('ok')
      expect(data.timestamp).toBeDefined()
      expect(data.uptime).toBeDefined()
    })
  })

  describe('/api/healthz', () => {
    it('should return detailed health status', async () => {
      const request = new NextRequest('http://localhost:3000/api/healthz')
      const response = await healthzGET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.status).toBe('ok')
      expect(data.timestamp).toBeDefined()
      expect(data.uptime).toBeDefined()
      expect(data.memory).toBeDefined()
      expect(data.memory.rss).toBeDefined()
      expect(data.memory.heapTotal).toBeDefined()
      expect(data.memory.heapUsed).toBeDefined()
      expect(data.memory.external).toBeDefined()
      expect(data.version).toBeDefined()
    })
  })
})
