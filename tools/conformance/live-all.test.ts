import { describe, expect, it } from 'vitest'
import { resolveLiveEnv } from './live-all.js'

describe('resolveLiveEnv', () => {
  it('should error naming both required variables when env is empty', () => {
    const resolved = resolveLiveEnv({})
    expect('error' in resolved).toBe(true)
    if ('error' in resolved) {
      expect(resolved.error).toMatch(/SOLVAPAY_SHADOW_BASE_URL/)
      expect(resolved.error).toMatch(/SOLVAPAY_SHADOW_API_KEY/)
    }
  })

  it('should derive USE_REAL_BACKEND and SOLVAPAY_SECRET_KEY from a populated env', () => {
    const resolved = resolveLiveEnv({
      SOLVAPAY_SHADOW_BASE_URL: 'http://localhost:3010',
      SOLVAPAY_SHADOW_API_KEY: 'sk_sandbox_test',
    })
    expect('error' in resolved).toBe(false)
    if ('error' in resolved) {
      return
    }
    expect(resolved.env.USE_REAL_BACKEND).toBe('true')
    expect(resolved.env.SOLVAPAY_SECRET_KEY).toBe('sk_sandbox_test')
  })

  it('should mention localhost:3010 and not :3001 in the error text', () => {
    const resolved = resolveLiveEnv({})
    expect('error' in resolved).toBe(true)
    if ('error' in resolved) {
      expect(resolved.error).toContain('http://localhost:3010')
      expect(resolved.error).not.toContain(':3001')
    }
  })
})
