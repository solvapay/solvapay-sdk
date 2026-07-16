import { afterEach, describe, expect, it } from 'vitest'
import {
  createDefaultRegistry,
  FixtureRegistry,
  mulberry32,
  replayFixture,
  type FixtureBinding,
} from './fixture-harness.js'
import type { Fixture } from './fixture-schema.js'

const originalDateNow = Date.now
const originalMathRandom = Math.random
const originalFetch = globalThis.fetch

afterEach(() => {
  Date.now = originalDateNow
  Math.random = originalMathRandom
  globalThis.fetch = originalFetch
})

function binding(
  id: string,
  invoke: FixtureBinding['invoke'],
): FixtureBinding {
  return { id, invoke }
}

function registryWith(...entries: Array<[string, FixtureBinding]>): FixtureRegistry {
  const registry = new FixtureRegistry()
  for (const [fn, b] of entries) {
    registry.register(fn, b)
  }
  return registry
}

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('matches the idempotency-key random fragment used by sample fixtures', () => {
    const random9 = mulberry32(42)().toString(36).substr(2, 9)
    expect(random9).toBe('ln13h9a6y')
  })
})

describe('FixtureRegistry', () => {
  it('returns all bindings registered for a name', () => {
    const registry = registryWith(
      ['verifyWebhook', binding('node', () => 'node')],
      ['verifyWebhook', binding('edge', () => 'edge')],
    )
    expect(registry.get('verifyWebhook').map(b => b.id)).toEqual(['node', 'edge'])
  })

  it('throws when no binding is registered', () => {
    const registry = new FixtureRegistry()
    expect(() => registry.get('missing')).toThrow(/No binding registered for fn: missing/)
  })
})

describe('createDefaultRegistry', () => {
  it('registers node and edge bindings for verifyWebhook', () => {
    const registry = createDefaultRegistry()
    expect(registry.get('verifyWebhook').map(b => b.id)).toEqual(['node', 'edge'])
  })
})

describe('replayFixture', () => {
  it('injects Date.now from input.clock and restores afterward', async () => {
    let seen: number | undefined
    const registry = registryWith([
      'probe',
      binding('test', () => {
        seen = Date.now()
        return { ok: true }
      }),
    ])

    await replayFixture(
      {
        suite: 'harness',
        case: 'clock',
        input: { fn: 'probe', args: {}, clock: '2026-07-01T00:00:00Z' },
        expect: { result: { ok: true } },
      },
      { registry },
    )

    expect(seen).toBe(Date.parse('2026-07-01T00:00:00Z'))
    expect(Date.now).toBe(originalDateNow)
  })

  it('injects seeded Math.random and restores afterward', async () => {
    let seen: number | undefined
    const registry = registryWith([
      'probe',
      binding('test', () => {
        seen = Math.random()
        return { ok: true }
      }),
    ])

    await replayFixture(
      {
        suite: 'harness',
        case: 'rng',
        input: { fn: 'probe', args: {}, rngSeed: 42 },
        expect: { result: { ok: true } },
      },
      { registry },
    )

    expect(seen).toBe(mulberry32(42)())
    expect(Math.random).toBe(originalMathRandom)
  })

  it('mocks fetch, asserts wire.request, and returns wire.response', async () => {
    const registry = registryWith([
      'probe',
      binding('test', async () => {
        const res = await fetch('https://api.solvapay.com/v1/sdk/payment-intents', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk_test_fixture',
            'Idempotency-Key': 'payment-plan_basic-1782864000000-ln13h9a6y',
          },
          body: JSON.stringify({
            productRef: 'prod_fixture',
            planRef: 'plan_basic',
            customerRef: 'cus_fixture',
          }),
        })
        return res.json()
      }),
    ])

    const fixture: Fixture = {
      suite: 'harness',
      case: 'wire',
      input: { fn: 'probe', args: {} },
      wire: {
        request: {
          method: 'POST',
          path: '/v1/sdk/payment-intents',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk_test_fixture',
            'Idempotency-Key': 'payment-plan_basic-1782864000000-ln13h9a6y',
          },
          body: {
            productRef: 'prod_fixture',
            planRef: 'plan_basic',
            customerRef: 'cus_fixture',
          },
        },
        response: {
          status: 200,
          body: { id: 'pi_fixture_1' },
        },
      },
      expect: { result: { id: 'pi_fixture_1' } },
    }

    await replayFixture(fixture, { registry })
    expect(globalThis.fetch).toBe(originalFetch)
  })

  it('deep-equals expect.result', async () => {
    const registry = registryWith([
      'probe',
      binding('test', () => ({ a: 1, nested: { b: 'x' } })),
    ])

    await expect(
      replayFixture(
        {
          suite: 'harness',
          case: 'result',
          input: { fn: 'probe', args: {} },
          expect: { result: { a: 1, nested: { b: 'x' } } },
        },
        { registry },
      ),
    ).resolves.toBeUndefined()

    await expect(
      replayFixture(
        {
          suite: 'harness',
          case: 'result-mismatch',
          input: { fn: 'probe', args: {} },
          expect: { result: { a: 2 } },
        },
        { registry },
      ),
    ).rejects.toThrow()
  })

  it('asserts expect.error name and byte-exact message', async () => {
    const registry = registryWith([
      'probe',
      binding('test', () => {
        const err = new Error('Webhook signature timestamp too old')
        err.name = 'SolvaPayError'
        throw err
      }),
    ])

    await expect(
      replayFixture(
        {
          suite: 'harness',
          case: 'error',
          input: { fn: 'probe', args: {} },
          expect: {
            error: {
              name: 'SolvaPayError',
              message: 'Webhook signature timestamp too old',
              kind: 'Webhook',
              code: 'timestamp_too_old',
            },
          },
        },
        { registry },
      ),
    ).resolves.toBeUndefined()
  })

  it('asserts expect.error.status when provided', async () => {
    const registry = registryWith([
      'probe',
      binding('test', () => {
        const err = Object.assign(new Error('Create payment intent failed (400): bad'), {
          name: 'SolvaPayError',
          status: 400,
        })
        throw err
      }),
    ])

    await expect(
      replayFixture(
        {
          suite: 'harness',
          case: 'error-status',
          input: { fn: 'probe', args: {} },
          expect: {
            error: {
              name: 'SolvaPayError',
              message: 'Create payment intent failed (400): bad',
              status: 400,
            },
          },
        },
        { registry },
      ),
    ).resolves.toBeUndefined()
  })

  it('fails when expect.error but binding succeeds', async () => {
    const registry = registryWith(['probe', binding('test', () => ({ ok: true }))])

    await expect(
      replayFixture(
        {
          suite: 'harness',
          case: 'expected-error',
          input: { fn: 'probe', args: {} },
          expect: { error: { name: 'SolvaPayError', message: 'nope' } },
        },
        { registry },
      ),
    ).rejects.toThrow(/expected an error/)
  })

  it('restores globals even when the assertion fails', async () => {
    const registry = registryWith(['probe', binding('test', () => ({ ok: false }))])

    await expect(
      replayFixture(
        {
          suite: 'harness',
          case: 'restore-on-fail',
          input: {
            fn: 'probe',
            args: {},
            clock: '2026-07-01T00:00:00Z',
            rngSeed: 7,
          },
          expect: { result: { ok: true } },
        },
        { registry },
      ),
    ).rejects.toThrow()

    expect(Date.now).toBe(originalDateNow)
    expect(Math.random).toBe(originalMathRandom)
  })

  it('replays against every binding registered for input.fn', async () => {
    const seen: string[] = []
    const registry = registryWith(
      [
        'verifyWebhook',
        binding('node', () => {
          seen.push('node')
          return { ok: true }
        }),
      ],
      [
        'verifyWebhook',
        binding('edge', () => {
          seen.push('edge')
          return { ok: true }
        }),
      ],
    )

    await replayFixture(
      {
        suite: 'harness',
        case: 'multi-binding',
        input: { fn: 'verifyWebhook', args: {} },
        expect: { result: { ok: true } },
      },
      { registry },
    )

    expect(seen).toEqual(['node', 'edge'])
  })
})
