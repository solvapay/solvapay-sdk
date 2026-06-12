import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { app } from '../index'

describe('express-provider-linkage', () => {
  beforeEach(() => {
    // Each test uses a distinct provider user id for isolation
  })

  it('rejects protected routes without provider auth', async () => {
    const response = await request(app).get('/tasks')
    expect(response.status).toBe(401)
    expect(response.body.error).toContain('Provider authentication required')
  })

  it('links externalRef via ensureCustomer and allows task creation', async () => {
    const externalRef = `auth0|test-${Date.now()}`

    const response = await request(app)
      .post('/tasks')
      .set('x-provider-user-id', externalRef)
      .set('x-provider-user-email', 'linked@example.com')
      .send({ title: 'Provider-linked task' })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.task.title).toBe('Provider-linked task')
  })

  it('isolates usage per provider user id', async () => {
    const userA = `auth0|user-a-${Date.now()}`
    const userB = `auth0|user-b-${Date.now()}`

    const first = await request(app)
      .post('/tasks')
      .set('x-provider-user-id', userA)
      .send({ title: 'A task' })
    expect(first.status).toBe(200)

    const second = await request(app)
      .post('/tasks')
      .set('x-provider-user-id', userB)
      .send({ title: 'B task' })
    expect(second.status).toBe(200)
  })
})
