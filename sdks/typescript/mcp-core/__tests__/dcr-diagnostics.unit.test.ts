import { afterEach, describe, expect, it, vi } from 'vitest'
import { logDcrFailureDiagnostic } from '../src/dcr-diagnostics'

describe('logDcrFailureDiagnostic', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('names product non-resolution when the body looks like Invalid identifier', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logDcrFailureDiagnostic({
      productRef: 'prd_missing',
      apiBaseUrl: 'https://api-dev.solvapay.com',
      status: 400,
      bodyText:
        'Invalid identifier. Use mcp_server_id for hosted MCP, or product_ref for non-hosted MCP.',
    })
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('prd_missing')
    expect(message).toContain('api-dev.solvapay.com')
    expect(message).toMatch(/did not resolve/i)
  })

  it('still logs a generic hint for other non-2xx bodies', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logDcrFailureDiagnostic({
      productRef: 'prd_x',
      apiBaseUrl: 'https://api.solvapay.com',
      status: 500,
      bodyText: 'internal error',
    })
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('OAuth DCR failed (500)')
    expect(message).toMatch(/doctor/)
  })
})
