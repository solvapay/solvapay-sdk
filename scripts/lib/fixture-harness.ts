/**
 * TS golden-fixture harness: injected clock, seeded RNG, mock transport.
 *
 * Replays §5.3 JSON fixtures against `@solvapay/server` bindings. The SDK
 * itself is unchanged in Phase 0 — host globals are patched for the call
 * and restored in `finally`.
 */

import assert from 'node:assert/strict'
import { createSolvaPayClient, verifyWebhook } from '@solvapay/server'
import { verifyWebhook as verifyWebhookEdge } from '@solvapay/server/edge'
import type { Fixture, FixtureErrorExpect, FixtureWire } from './fixture-schema.js'

export type FixtureBinding = {
  /** Distinguishes multiple bindings for the same `input.fn` (e.g. node vs edge). */
  id: string
  invoke: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

export class FixtureRegistry {
  private readonly bindings = new Map<string, FixtureBinding[]>()

  register(fn: string, binding: FixtureBinding): void {
    const list = this.bindings.get(fn) ?? []
    list.push(binding)
    this.bindings.set(fn, list)
  }

  get(fn: string): FixtureBinding[] {
    const list = this.bindings.get(fn)
    if (!list || list.length === 0) {
      throw new Error(`No binding registered for fn: ${fn}`)
    }
    return list
  }
}

/** Deterministic PRNG used to stabilize `Math.random()` under fixtures. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type ReplayOptions = {
  registry: FixtureRegistry
}

type CapturedRequest = {
  method: string
  path: string
  headers: Record<string, string>
  body: unknown
}

type GlobalSnapshot = {
  dateNow: typeof Date.now
  mathRandom: typeof Math.random
  fetch: typeof globalThis.fetch
}

function snapshotGlobals(): GlobalSnapshot {
  return {
    dateNow: Date.now,
    mathRandom: Math.random,
    fetch: globalThis.fetch,
  }
}

function restoreGlobals(snapshot: GlobalSnapshot): void {
  Date.now = snapshot.dateNow
  Math.random = snapshot.mathRandom
  globalThis.fetch = snapshot.fetch
}

function patchClock(clock: string): void {
  const clockMs = Date.parse(clock)
  if (Number.isNaN(clockMs)) {
    throw new Error(`Invalid fixture clock: ${clock}`)
  }
  Date.now = () => clockMs
}

function patchRng(seed: number): void {
  const next = mulberry32(seed)
  Math.random = () => next()
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return input
  return new URL(input.url)
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[key] = value
    }
    return out
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out[key] = value
    }
  }
  return out
}

function parseBody(raw: BodyInit | null | undefined): unknown {
  if (raw == null || raw === '') return undefined
  if (typeof raw !== 'string') {
    throw new Error('Fixture harness mock transport only supports string request bodies')
  }
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function installMockFetch(
  wire: FixtureWire,
  onCapture: (request: CapturedRequest) => void,
): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    onCapture({
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      headers: headersToRecord(init?.headers),
      body: parseBody(init?.body ?? null),
    })
    return new Response(JSON.stringify(wire.response.body), {
      status: wire.response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

function assertWireRequest(actual: CapturedRequest, expected: FixtureWire['request']): void {
  assert.equal(actual.method, expected.method, 'wire.request.method mismatch')
  assert.equal(actual.path, expected.path, 'wire.request.path mismatch')

  if (expected.headers) {
    const actualNorm = new Map(
      Object.entries(actual.headers).map(([k, v]) => [k.toLowerCase(), v]),
    )
    for (const [key, value] of Object.entries(expected.headers)) {
      assert.equal(
        actualNorm.get(key.toLowerCase()),
        value,
        `wire.request.headers[${key}] mismatch`,
      )
    }
  }

  if (expected.body !== undefined) {
    assert.deepEqual(actual.body, expected.body, 'wire.request.body mismatch')
  }
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = Reflect.get(error, 'status')
    return typeof status === 'number' ? status : undefined
  }
  return undefined
}

function assertExpectedError(error: unknown, expected: FixtureErrorExpect): void {
  if (!(error instanceof Error)) {
    throw new Error(`Fixture expected Error but binding threw non-Error: ${String(error)}`)
  }

  if (expected.name !== undefined) {
    assert.equal(error.name, expected.name, 'expect.error.name mismatch')
  }
  assert.equal(error.message, expected.message, 'expect.error.message mismatch')

  if (expected.status !== undefined) {
    assert.equal(getErrorStatus(error), expected.status, 'expect.error.status mismatch')
  }
}

function isCreatePaymentIntentArgs(
  args: Record<string, unknown>,
): args is {
  productRef: string
  planRef: string
  customerRef: string
  currency?: string
  idempotencyKey?: string
} {
  return (
    typeof args.productRef === 'string' &&
    typeof args.planRef === 'string' &&
    typeof args.customerRef === 'string' &&
    (args.currency === undefined || typeof args.currency === 'string') &&
    (args.idempotencyKey === undefined || typeof args.idempotencyKey === 'string')
  )
}

function isVerifyWebhookArgs(
  args: Record<string, unknown>,
): args is { body: string; signature: string; secret: string } {
  return (
    typeof args.body === 'string' &&
    typeof args.signature === 'string' &&
    typeof args.secret === 'string'
  )
}

/** Registers default SDK bindings (`verifyWebhook` node+edge, `createPaymentIntent`). */
export function createDefaultRegistry(): FixtureRegistry {
  const registry = new FixtureRegistry()

  registry.register('verifyWebhook', {
    id: 'node',
    invoke: args => {
      if (!isVerifyWebhookArgs(args)) {
        throw new Error('verifyWebhook args must include string body, signature, and secret')
      }
      return verifyWebhook(args)
    },
  })

  registry.register('verifyWebhook', {
    id: 'edge',
    invoke: args => {
      if (!isVerifyWebhookArgs(args)) {
        throw new Error('verifyWebhook args must include string body, signature, and secret')
      }
      return verifyWebhookEdge(args)
    },
  })

  registry.register('createPaymentIntent', {
    id: 'client',
    invoke: async args => {
      if (!isCreatePaymentIntentArgs(args)) {
        throw new Error(
          'createPaymentIntent args must include productRef, planRef, and customerRef strings',
        )
      }
      const client = createSolvaPayClient({
        apiKey: 'sk_test_fixture',
        apiBaseUrl: 'https://api.solvapay.com',
      })
      if (!client.createPaymentIntent) {
        throw new Error('createPaymentIntent is not available on SolvaPayClient')
      }
      return client.createPaymentIntent(args)
    },
  })

  return registry
}

export async function replayFixture(fixture: Fixture, options: ReplayOptions): Promise<void> {
  const bindings = options.registry.get(fixture.input.fn)
  for (const binding of bindings) {
    await replayAgainstBinding(fixture, binding)
  }
}

async function replayAgainstBinding(fixture: Fixture, binding: FixtureBinding): Promise<void> {
  const globals = snapshotGlobals()
  const captured: CapturedRequest[] = []

  try {
    if (fixture.input.clock !== undefined) {
      patchClock(fixture.input.clock)
    }
    if (fixture.input.rngSeed !== undefined) {
      patchRng(fixture.input.rngSeed)
    }
    if (fixture.wire) {
      installMockFetch(fixture.wire, request => {
        captured.push(request)
      })
    }

    let result: unknown
    let threw: unknown
    try {
      result = await binding.invoke(fixture.input.args)
    } catch (error) {
      threw = error
    }

    if (fixture.wire) {
      assert.equal(captured.length, 1, 'wire fixture expected exactly one fetch call')
      const request = captured[0]
      assert.ok(request, 'wire fixture captured no request')
      assertWireRequest(request, fixture.wire.request)
    }

    if (fixture.expect.error !== undefined) {
      if (threw === undefined) {
        throw new Error(
          `Fixture ${fixture.suite}/${fixture.case} (${binding.id}) expected an error but binding succeeded`,
        )
      }
      assertExpectedError(threw, fixture.expect.error)
      return
    }

    if (threw !== undefined) {
      throw threw
    }

    assert.deepEqual(
      result,
      fixture.expect.result,
      `Fixture ${fixture.suite}/${fixture.case} (${binding.id}) result mismatch`,
    )
  } finally {
    restoreGlobals(globals)
  }
}
