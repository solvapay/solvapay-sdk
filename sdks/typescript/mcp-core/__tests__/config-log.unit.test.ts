import { afterEach, describe, expect, it, vi } from 'vitest'
import { logMcpConfigOnce, resetMcpConfigLogForTests } from '../src/config-log'

describe('logMcpConfigOnce', () => {
  afterEach(() => {
    resetMcpConfigLogForTests()
    vi.restoreAllMocks()
  })

  it('emits a single config line to console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logMcpConfigOnce({
      apiBaseUrl: 'https://api.solvapay.com',
      productRef: 'prd_abc',
      publicBaseUrl: 'https://mcp.example.com',
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/\[solvapay\] mcp config/)
    expect(warn.mock.calls[0]?.[0]).toContain('prd_abc')
  })

  it('logs only once per process even when called repeatedly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logMcpConfigOnce({
      apiBaseUrl: 'https://api.solvapay.com',
      productRef: 'prd_1',
      publicBaseUrl: 'https://a.example.com',
    })
    logMcpConfigOnce({
      apiBaseUrl: 'https://api.solvapay.com',
      productRef: 'prd_2',
      publicBaseUrl: 'https://b.example.com',
    })
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
