import { describe, expect, it } from 'vitest'
import {
  runGeneratedGateLoop,
  runGeneratedPayableLoop,
  type GateDriverHost,
  type PayableDriverHost,
} from '../src/drivers.generated.js'

describe('runGeneratedGateLoop', () => {
  it('replays a cache-hit allow through the generated host loop', async () => {
    const events: unknown[] = []
    const host: GateDriverHost = {
      ensureCustomer: async () => {
        throw new Error('ensure should not run for cus_ refs')
      },
      readLimitsCache: async () => ({
        found: true,
        remaining: 5,
        limits: { withinLimits: true, remaining: 5 },
        timestampMs: 1_000,
      }),
      checkLimits: async () => {
        throw new Error('checkLimits should not run on cache hit')
      },
      applyCache: () => {
        events.push('cache')
      },
      nowMs: () => 1_010,
    }

    const steps = [
      {
        state: { product: 'prd_1' },
        action: { kind: 'readLimitsCache', key: 'cus_1:prd_1:requests' },
      },
      {
        state: { product: 'prd_1' },
        action: {
          kind: 'allow',
          customerRef: 'cus_1',
          limits: { remaining: 4 },
          requestId: 'req_1',
        },
      },
    ]
    let i = 0
    const out = await runGeneratedGateLoop(
      (_state, event) => {
        events.push(event)
        const step = steps[i]
        i += 1
        if (step === undefined) {
          throw new Error('extra gate_next call')
        }
        return step
      },
      host,
      { kind: 'start', customerRef: 'cus_1', product: 'prd_1' },
    )

    expect(out.action.kind).toBe('allow')
    expect(events[0]).toEqual({ kind: 'start', customerRef: 'cus_1', product: 'prd_1' })
    expect(events).toContain('cache')
  })

  it('replays ensureCustomer then checkLimits then gate', async () => {
    const host: GateDriverHost = {
      ensureCustomer: async ref => `cus_${ref}`,
      readLimitsCache: async () => ({ found: false }),
      checkLimits: async args => ({
        withinLimits: false,
        remaining: 0,
        customerRef: args.customerRef,
      }),
      applyCache: () => undefined,
      nowMs: () => 50,
    }
    const kinds = ['ensureCustomer', 'readLimitsCache', 'checkLimits', 'gate']
    let i = 0
    const out = await runGeneratedGateLoop(
      (_state, event) => {
        const kind = kinds[i]
        i += 1
        if (kind === 'ensureCustomer') {
          expect((event as { kind: string }).kind).toBe('start')
          return { state: {}, action: { kind: 'ensureCustomer', customerRef: 'user@x' } }
        }
        if (kind === 'readLimitsCache') {
          expect((event as { kind: string }).kind).toBe('customerResolved')
          return { state: {}, action: { kind: 'readLimitsCache', key: 'k' } }
        }
        if (kind === 'checkLimits') {
          expect((event as { found: boolean }).found).toBe(false)
          return {
            state: {},
            action: {
              kind: 'checkLimits',
              customerRef: 'cus_user',
              productRef: 'prd',
              meterName: 'requests',
              includeCheckoutSession: true,
            },
          }
        }
        return { state: {}, action: { kind: 'gate', gate: { message: 'pay' } } }
      },
      host,
      { kind: 'start', customerRef: 'user@x' },
    )
    expect(out.action.kind).toBe('gate')
  })
})

describe('runGeneratedPayableLoop', () => {
  it('runs gate → handler → done and tracks usage', async () => {
    const tracked: unknown[] = []
    const host: PayableDriverHost = {
      nowMs: () => 50,
      randomUnit: () => 0.25,
      runGate: async () => ({
        kind: 'allow',
        customerRef: 'cus_1',
        limits: { remaining: 4 },
      }),
      invokeHandler: async () => ({
        kind: 'ok',
        envelope: { __solvapayResponse: true, value: { ok: true } },
      }),
      trackUsage: async request => {
        tracked.push(request)
      },
    }
    const kinds = ['runGate', 'invokeHandler', 'done']
    let i = 0
    const result = await runGeneratedPayableLoop(
      (_state, event) => {
        const kind = kinds[i]
        i += 1
        if (kind === 'runGate') {
          expect((event as { kind: string }).kind).toBe('start')
          return {
            state: {},
            action: {
              kind: 'runGate',
              customerRef: 'cus_1',
              product: 'prd',
              usageType: 'requests',
            },
          }
        }
        if (kind === 'invokeHandler') {
          expect((event as { kind: string }).kind).toBe('gateAllow')
          return { state: {}, action: { kind: 'invokeHandler', customerRef: 'cus_1', limits: {} } }
        }
        expect((event as { kind: string }).kind).toBe('handlerOk')
        return {
          state: {},
          action: {
            kind: 'done',
            result: { structuredContent: { ok: true } },
            track: { request: { units: 1 } },
          },
        }
      },
      host,
      { kind: 'start', customerRef: 'cus_1', product: 'prd', usageType: 'requests' },
    )
    expect(result).toEqual({ structuredContent: { ok: true } })
    expect(tracked).toEqual([{ units: 1 }])
  })
})
