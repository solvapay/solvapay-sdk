import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../shared/paths.js'
import {
  runGeneratedGateLoop,
  type GateDriverHost,
} from '../../sdks/typescript/server/src/drivers.generated.js'
import { HOST_FNS } from './lib/host-fns.generated.js'

const DRIVER_LOOP = path.join(REPO_ROOT, 'contract/fixtures/driver-loop')

function loadCorpus(): Array<{ rel: string; fn: string }> {
  return readdirSync(DRIVER_LOOP)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => {
      const raw = JSON.parse(readFileSync(path.join(DRIVER_LOOP, name), 'utf8')) as {
        input: { fn: string }
      }
      return { rel: name, fn: raw.input.fn }
    })
}

describe('generated driver-loop corpus', () => {
  it('lists every driver-loop fixture and host fn', () => {
    const corpus = loadCorpus()
    expect(corpus).toHaveLength(8)
    expect(HOST_FNS).toEqual(expect.arrayContaining(['driveGate', 'drivePayable', 'withRetry']))
    expect(new Set(corpus.map(item => item.fn)).has('driveGate')).toBe(true)
    expect(new Set(corpus.map(item => item.fn)).has('drivePayable')).toBe(true)
  })

  it('replays cache-hit allow through the generated TypeScript loop', async () => {
    const events: unknown[] = []
    const host: GateDriverHost = {
      ensureCustomer: async () => {
        throw new Error('ensure should not run')
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
        state: { product: 'prd_demo' },
        action: { kind: 'readLimitsCache', key: 'cus_abc:prd_demo:requests' },
      },
      {
        state: { product: 'prd_demo' },
        action: { kind: 'allow', customerRef: 'cus_abc', limits: { remaining: 4 } },
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
      { kind: 'start', customerRef: 'cus_abc', product: 'prd_demo' },
    )
    expect(out.action.kind).toBe('allow')
    expect(events).toContain('cache')
  })
})
