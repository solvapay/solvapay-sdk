import { afterEach, describe, expect, it } from 'vitest'
import {
  createDefaultRegistry,
  FixtureRegistry,
  installDelayRecorder,
  mulberry32,
  replayFixture,
  type FixtureBinding,
} from './fixture-harness.js'
import type { Fixture } from './fixture-schema.js'

const originalDateNow = Date.now
const originalMathRandom = Math.random
const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout

afterEach(() => {
  Date.now = originalDateNow
  Math.random = originalMathRandom
  globalThis.fetch = originalFetch
  globalThis.setTimeout = originalSetTimeout
})

function binding(id: string, invoke: FixtureBinding['invoke']): FixtureBinding {
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

  it('registers a withRetry binding', () => {
    const registry = createDefaultRegistry()
    expect(registry.get('withRetry').map(b => b.id)).toEqual(['server'])
  })

  it('registers paywall pure-function bindings', () => {
    const registry = createDefaultRegistry()
    expect(registry.get('classifyPaywallState').map(b => b.id)).toEqual(['server'])
    expect(registry.get('buildPaywallGate').map(b => b.id)).toEqual(['server'])
    expect(registry.get('buildGateMessage').map(b => b.id)).toEqual(['server'])
    expect(registry.get('buildNudgeMessage').map(b => b.id)).toEqual(['server'])
    expect(registry.get('paywallErrorToClientPayload').map(b => b.id)).toEqual(['server'])
  })

  it('registers client bindings for representative methods', () => {
    const registry = createDefaultRegistry()
    expect(registry.get('checkLimits').map(b => b.id)).toEqual(['client'])
    expect(registry.get('deleteProduct').map(b => b.id)).toEqual(['client'])
    expect(registry.get('getCustomer').map(b => b.id)).toEqual(['client'])
  })
})

describe('paywall bindings', () => {
  it('classifyPaywallState returns topup_required for usage-based at creditBalance 0', () => {
    const [binding] = createDefaultRegistry().get('classifyPaywallState')
    expect(binding).toBeDefined()
    expect(
      binding?.invoke({
        limits: {
          plan: 'pl_pro',
          remaining: 0,
          plans: [{ reference: 'pl_pro', type: 'usage-based', requiresPayment: true }],
          balance: { creditBalance: 0, creditsPerUnit: 1, currency: 'usd' },
        },
      }),
    ).toEqual({ kind: 'topup_required' })
  })

  it('buildPaywallGate reclassifies PAYG topup to activation_required with plans', () => {
    const [binding] = createDefaultRegistry().get('buildPaywallGate')
    expect(binding).toBeDefined()
    const result = binding?.invoke({
      productRef: 'prd_demo',
      limits: {
        plan: 'pl_pro',
        remaining: 0,
        checkoutUrl: 'https://pay.test/x',
        plans: [{ reference: 'pl_pro', type: 'usage-based', requiresPayment: true }],
        balance: { creditBalance: 0, creditsPerUnit: 1, currency: 'usd' },
      },
    })
    expect(result).toMatchObject({
      kind: 'activation_required',
      product: 'prd_demo',
      plans: [{ reference: 'pl_pro', type: 'usage-based', requiresPayment: true }],
    })
    expect(result).toHaveProperty('message', expect.stringContaining('`topup`'))
  })

  it('buildGateMessage returns byte-exact topup copy with url clause', () => {
    const [binding] = createDefaultRegistry().get('buildGateMessage')
    expect(binding).toBeDefined()
    expect(
      binding?.invoke({
        state: { kind: 'topup_required' },
        gate: {
          kind: 'payment_required',
          product: 'prd_demo',
          checkoutUrl: 'https://pay.test/x',
          message: '',
        },
      }),
    ).toBe(
      "You're out of credits. Call the `topup` tool to add more, or open https://pay.test/x in a browser.",
    )
  })

  it('buildNudgeMessage returns byte-exact upgrade copy without url when absent', () => {
    const [binding] = createDefaultRegistry().get('buildNudgeMessage')
    expect(binding).toBeDefined()
    expect(
      binding?.invoke({
        state: { kind: 'upgrade_required' },
        limits: { plan: 'pl_basic', remaining: 1 },
      }),
    ).toBe(
      "Heads up — approaching your plan's limit this period. Call the `upgrade` tool for more headroom.",
    )
  })

  it('paywallErrorToClientPayload maps activation_required to Activation required', () => {
    const [binding] = createDefaultRegistry().get('paywallErrorToClientPayload')
    expect(binding).toBeDefined()
    expect(
      binding?.invoke({
        message: 'activate please',
        structuredContent: {
          kind: 'activation_required',
          product: 'prd_demo',
          checkoutUrl: 'https://pay.test/confirm',
          message: 'activate please',
        },
      }),
    ).toEqual({
      success: false,
      error: 'Activation required',
      product: 'prd_demo',
      checkoutUrl: 'https://pay.test/confirm',
      message: 'activate please',
      kind: 'activation_required',
    })
  })
})

describe('installDelayRecorder', () => {
  it('records each ms, fires the callback immediately, and restores on restore()', () => {
    const slept: number[] = []
    const { delays, restore } = installDelayRecorder(ms => {
      slept.push(ms)
    })

    let fired = false
    const handle = globalThis.setTimeout(() => {
      fired = true
    }, 500)

    expect(handle).toBe(0)
    expect(fired).toBe(true)
    expect(delays).toEqual([500])
    expect(slept).toEqual([500])

    restore()
    expect(globalThis.setTimeout).toBe(originalSetTimeout)
  })
})

describe('withRetry binding', () => {
  it('returns delays, ordered events, and a resolved outcome for fixed backoff', async () => {
    const [binding] = createDefaultRegistry().get('withRetry')
    expect(binding).toBeDefined()

    const observation = await binding?.invoke({
      attempts: [{ throw: 'boom' }, { resolve: { ok: true } }],
      options: { maxRetries: 2, initialDelay: 500, backoffStrategy: 'fixed' },
    })

    expect(observation).toEqual({
      delays: [500],
      events: ['call:0', 'sleep:500', 'call:1'],
      outcome: { type: 'resolved', value: { ok: true } },
    })
    expect(globalThis.setTimeout).toBe(originalSetTimeout)
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

  it('captures and asserts wire.request.query from the request URL', async () => {
    const registry = registryWith([
      'probe',
      binding('test', async () => {
        const res = await fetch(
          'https://api.solvapay.com/v1/sdk/customers?externalRef=ext_fixture',
          { method: 'GET' },
        )
        return res.json()
      }),
    ])

    await replayFixture(
      {
        suite: 'harness',
        case: 'wire-query',
        input: { fn: 'probe', args: {} },
        wire: {
          request: {
            method: 'GET',
            path: '/v1/sdk/customers',
            query: { externalRef: 'ext_fixture' },
          },
          response: { status: 200, body: { customerRef: 'cus_fixture' } },
        },
        expect: { result: { customerRef: 'cus_fixture' } },
      },
      { registry },
    )
  })

  it('sends string wire.response.body values verbatim (not JSON-stringified)', async () => {
    const registry = registryWith([
      'probe',
      binding('test', async () => {
        const res = await fetch('https://api.solvapay.com/v1/sdk/limits', { method: 'POST' })
        return res.text()
      }),
    ])

    await replayFixture(
      {
        suite: 'harness',
        case: 'wire-string-body',
        input: { fn: 'probe', args: {} },
        wire: {
          request: { method: 'POST', path: '/v1/sdk/limits' },
          response: { status: 400, body: 'bad' },
        },
        expect: { result: 'bad' },
      },
      { registry },
    )
  })

  it('coerces undefined deleteProduct results to null via the client invoker', async () => {
    await replayFixture(
      {
        suite: 'harness',
        case: 'void-null',
        input: { fn: 'deleteProduct', args: { productRef: 'prd_fixture' } },
        wire: {
          request: {
            method: 'DELETE',
            path: '/v1/sdk/products/prd_fixture',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer sk_test_fixture',
            },
          },
          response: { status: 200, body: null },
        },
        expect: { result: null },
      },
      { registry: createDefaultRegistry() },
    )
  })

  it('deep-equals expect.result', async () => {
    const registry = registryWith(['probe', binding('test', () => ({ a: 1, nested: { b: 'x' } }))])

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
