import { afterEach, describe, expect, it, vi } from 'vitest'
import { LANGUAGE_RUNTIME_DEPS, resolveLatestVersions } from './versions'

describe('resolveLatestVersions', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('parses npm latest for TypeScript', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ version: '9.9.9' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const map = await resolveLatestVersions('ts', [{ name: '@solvapay/mcp', fallback: '0.3.0' }], {
      onResolve: () => {},
    })
    expect(map.get('@solvapay/mcp')).toBe('9.9.9')
  })

  it('parses PyPI info.version for Python', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ info: { version: '0.4.2' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const map = await resolveLatestVersions('python', [{ name: 'solvapay', fallback: '0.1.0' }], {
      onResolve: () => {},
    })
    expect(map.get('solvapay')).toBe('0.4.2')
  })

  it('parses crates.io max_stable_version for Rust', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ crate: { max_stable_version: '0.2.1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    const map = await resolveLatestVersions('rust', [{ name: 'solvapay', fallback: '0.1.0' }], {
      onResolve: () => {},
    })
    expect(map.get('solvapay')).toBe('0.2.1')
  })

  it('falls back when fetch throws', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENETUNREACH')
    }) as typeof fetch

    const map = await resolveLatestVersions('ruby', LANGUAGE_RUNTIME_DEPS.ruby, {
      onResolve: () => {},
    })
    expect(map.get('solvapay')).toBe('0.1.0')
    expect(map.get('solvapay-mcp')).toBe('0.1.0')
  })

  it('falls back on non-2xx', async () => {
    globalThis.fetch = vi.fn(async () => new Response('gone', { status: 404 })) as typeof fetch
    const map = await resolveLatestVersions('go', LANGUAGE_RUNTIME_DEPS.go, { onResolve: () => {} })
    expect(map.get('github.com/solvapay/solvapay-go')).toBe('v0.1.0')
  })
})
