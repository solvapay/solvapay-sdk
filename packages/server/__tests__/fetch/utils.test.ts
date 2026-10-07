import { describe, it, expect } from 'vitest'
import { jsonResponse, errorResponse } from '../../src/fetch/utils'

describe('jsonResponse', () => {
  it('returns a Response with JSON body and 200 status by default', async () => {
    const res = jsonResponse({ hello: 'world' })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(await res.json()).toEqual({ hello: 'world' })
  })

  it('supports custom status codes', async () => {
    const res = jsonResponse({ created: true }, 201)

    expect(res.status).toBe(201)
  })

  it('merges extra headers', async () => {
    const res = jsonResponse({ data: 1 }, 200, { 'X-Custom': 'test' })

    expect(res.headers.get('X-Custom')).toBe('test')
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })
})

describe('errorResponse', () => {
  it('returns a Response with error body and given status', async () => {
    const res = errorResponse({ error: 'Not found', status: 404 })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
  })

  it('includes details when present', async () => {
    const res = errorResponse({ error: 'Bad request', status: 400, details: 'Missing field' })

    const body = await res.json()
    expect(body.error).toBe('Bad request')
    expect(body.details).toBe('Missing field')
  })

  it('carries the backend error key and decline fields, and nothing else', async () => {
    const res = errorResponse({
      error: 'Confirm payment failed (402): Payment card_declined',
      status: 402,
      code: 'payment_declined',
      reason: 'card_declined',
      declineCode: 'insufficient_funds',
    })

    expect(res.status).toBe(402)
    expect(await res.json()).toStrictEqual({
      error: 'Confirm payment failed (402): Payment card_declined',
      code: 'payment_declined',
      reason: 'card_declined',
      declineCode: 'insufficient_funds',
    })
  })
})
