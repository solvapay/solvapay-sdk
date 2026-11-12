import { afterEach, describe, expect, it, vi } from 'vitest'
import { RELEASE_TRAIN_VERSION } from './release-train-version.generated'
import { LANGUAGE_RUNTIME_DEPS, resolveLatestVersions } from './versions'

describe('LANGUAGE_RUNTIME_DEPS', () => {
  it('pins --offline versions to the stamped release-train version', () => {
    expect(RELEASE_TRAIN_VERSION.length).toBeGreaterThan(0)
    for (const language of ['ts', 'python', 'ruby', 'rust'] as const) {
      for (const dep of LANGUAGE_RUNTIME_DEPS[language]) {
        expect(dep.fallback).toBe(RELEASE_TRAIN_VERSION)
      }
    }
    expect(LANGUAGE_RUNTIME_DEPS.go[0]?.fallback).toBe(`v${RELEASE_TRAIN_VERSION}`)
  })
})

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

  it('throws, naming the package and the cause, when fetch fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENETUNREACH')
    }) as typeof fetch

    await expect(
      resolveLatestVersions('ruby', LANGUAGE_RUNTIME_DEPS.ruby, { onResolve: () => {} }),
    ).rejects.toThrow(/solvapay: .*ENETUNREACH[\s\S]*--offline/)
  })

  it('throws on a 404, naming the package as not published', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as typeof fetch
    await expect(
      resolveLatestVersions('ts', [{ name: '@solvapay/server-wasm', fallback: '0.2.0' }], {
        onResolve: () => {},
      }),
    ).rejects.toThrow(/@solvapay\/server-wasm: .*answered 404 \(not published\)/)
  })

  it('throws on any other non-2xx response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('down', { status: 503 })) as typeof fetch
    await expect(
      resolveLatestVersions('go', LANGUAGE_RUNTIME_DEPS.go, { onResolve: () => {} }),
    ).rejects.toThrow(/answered 503/)
  })

  it('throws when the registry returns no version', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ notVersion: 'oops' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as typeof fetch
    await expect(
      resolveLatestVersions('python', [{ name: 'solvapay', fallback: '0.1.0' }], {
        onResolve: () => {},
      }),
    ).rejects.toThrow(/returned no version/)
  })

  it('uses the release-train pins with offline, without touching the network', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const onResolve = vi.fn()

    const map = await resolveLatestVersions('ruby', LANGUAGE_RUNTIME_DEPS.ruby, {
      offline: true,
      onResolve,
    })

    expect(map.get('solvapay')).toBe(RELEASE_TRAIN_VERSION)
    expect(map.get('solvapay-mcp')).toBe(RELEASE_TRAIN_VERSION)
    expect(fetchSpy).not.toHaveBeenCalled()
    for (const call of onResolve.mock.calls) {
      expect(call[0].source).toBe('pinned')
    }
  })
})
