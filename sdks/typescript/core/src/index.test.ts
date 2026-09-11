import { describe, expect, it } from 'vitest'
import { SolvaPayError } from './index'

describe('SolvaPayError', () => {
  it('constructs with only a message (backwards compatible)', () => {
    const err = new SolvaPayError('boom')
    expect(err.message).toBe('boom')
    expect(err.name).toBe('SolvaPayError')
    expect(err.status).toBeUndefined()
    expect(err.code).toBeUndefined()
    expect(err).toBeInstanceOf(Error)
  })

  it('preserves status when supplied', () => {
    const err = new SolvaPayError('not found', { status: 404 })
    expect(err.status).toBe(404)
    expect(err.code).toBeUndefined()
  })

  it('preserves code when supplied', () => {
    const err = new SolvaPayError('missing config', { code: 'missing_secret' })
    expect(err.code).toBe('missing_secret')
    expect(err.status).toBeUndefined()
  })

  it('preserves both status and code', () => {
    const err = new SolvaPayError('forbidden', { status: 403, code: 'forbidden' })
    expect(err.status).toBe(403)
    expect(err.code).toBe('forbidden')
  })
})
