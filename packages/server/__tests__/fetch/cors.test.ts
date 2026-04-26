import { describe, it, expect, beforeEach } from 'vitest'
import { configureCors, handleCors, getCorsHeaders } from '../../src/fetch/cors'

describe('cors', () => {
  beforeEach(() => {
    configureCors({ origins: ['*'] })
  })

  describe('handleCors', () => {
    it('returns a 204 Response for OPTIONS requests', () => {
      const req = new Request('http://localhost/api/test', { method: 'OPTIONS' })
      const res = handleCors(req)

      expect(res).toBeInstanceOf(Response)
      expect(res!.status).toBe(204)
      expect(res!.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(res!.headers.get('Access-Control-Allow-Methods')).toBeTruthy()
    })

    it('returns null for non-OPTIONS requests', () => {
      const req = new Request('http://localhost/api/test', { method: 'GET' })
      const res = handleCors(req)

      expect(res).toBeNull()
    })
  })

  describe('configureCors', () => {
    it('restricts origin to configured list', () => {
      configureCors({ origins: ['https://myapp.com'] })

      const req = new Request('http://localhost/api/test', {
        method: 'OPTIONS',
        headers: { Origin: 'https://myapp.com' },
      })
      const res = handleCors(req)

      expect(res!.headers.get('Access-Control-Allow-Origin')).toBe('https://myapp.com')
    })

    it('rejects disallowed origins', () => {
      configureCors({ origins: ['https://myapp.com'] })

      const req = new Request('http://localhost/api/test', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.com' },
      })
      const res = handleCors(req)

      expect(res!.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })
  })

  describe('getCorsHeaders', () => {
    it('returns headers object with CORS values for wildcard', () => {
      configureCors({ origins: ['*'] })

      const req = new Request('http://localhost/api/test')
      const headers = getCorsHeaders(req)

      expect(headers['Access-Control-Allow-Origin']).toBe('*')
    })

    it('returns matching origin header for specific origins', () => {
      configureCors({ origins: ['https://myapp.com', 'http://localhost:5173'] })

      const req = new Request('http://localhost/api/test', {
        headers: { Origin: 'http://localhost:5173' },
      })
      const headers = getCorsHeaders(req)

      expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173')
    })
  })
})
