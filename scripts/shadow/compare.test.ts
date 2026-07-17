import { describe, expect, it } from 'vitest'
import {
  compareSides,
  deepEqualNormalized,
  firstDiffPath,
  type SideOutcome,
} from './compare.js'
import type { ShadowNormalizeRules } from './normalize.js'
import { formatHumanSummary, writeShadowReport, type ShadowReport } from './report.js'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RULES: ShadowNormalizeRules = {
  globalVolatileKeys: ['createdAt', 'reference'],
  volatileKeySuffixes: ['Ref'],
  refPrefixes: ['prd_', 'cus_'],
  pointers: [],
}

function ok(value: unknown, wire: SideOutcome['wire'] = []): SideOutcome {
  return { ok: true, value, wire }
}

describe('deepEqualNormalized', () => {
  it('equates integer and float forms of the same number', () => {
    expect(deepEqualNormalized(25, 25.0)).toBe(true)
    expect(deepEqualNormalized({ n: 25 }, { n: 25.0 })).toBe(true)
  })

  it('detects structural mismatch', () => {
    expect(deepEqualNormalized({ a: 1 }, { a: 2 })).toBe(false)
    expect(firstDiffPath({ a: 1 }, { a: 2 })).toBe('/a')
  })
})

describe('compareSides', () => {
  it('returns identical after volatile normalization', () => {
    const result = compareSides({
      op: 'createProduct',
      args: { name: 'W' },
      ts: ok({ name: 'W', reference: 'prd_AAA', createdAt: 't1' }),
      rust: ok({ name: 'W', reference: 'prd_BBB', createdAt: 't2' }),
      rules: RULES,
    })
    expect(result.identical).toBe(true)
    if (result.identical) {
      expect(result.tsNormalized).toEqual({
        ok: true,
        value: {
          name: 'W',
        },
      })
    }
  })

  it('produces a Divergence with both wire exchanges on mismatch', () => {
    const tsWire = [
      {
        method: 'POST',
        url: 'http://localhost/v1/sdk/products',
        status: 200,
        responseBody: { name: 'W', price: 1 },
      },
    ]
    const rustWire = [
      {
        method: 'POST',
        url: 'http://localhost/v1/sdk/products',
        status: 200,
        responseBody: { name: 'W', price: 2 },
      },
    ]
    const result = compareSides({
      op: 'createProduct',
      args: { name: 'W' },
      ts: ok({ name: 'W', price: 1 }, tsWire),
      rust: ok({ name: 'W', price: 2 }, rustWire),
      rules: RULES,
    })
    expect(result.identical).toBe(false)
    if (!result.identical) {
      expect(result.divergence.op).toBe('createProduct')
      expect(result.divergence.tsWire).toEqual(tsWire)
      expect(result.divergence.rustWire).toEqual(rustWire)
      expect(result.divergence.path).toBe('/value/price')
    }
  })
})

describe('shadow report', () => {
  it('writes shadow-report.json and a human summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shadow-report-'))
    const report: ShadowReport = {
      startedAt: '2026-07-17T00:00:00.000Z',
      finishedAt: '2026-07-17T00:00:01.000Z',
      baseUrl: 'http://localhost:9',
      results: [
        { op: 'getMerchant', status: 'IDENTICAL' },
        {
          op: 'processPaymentIntent',
          status: 'SKIPPED',
          reason: 'requires: stripe',
        },
        {
          op: 'createProduct',
          status: 'DIVERGED',
          divergence: {
            op: 'createProduct',
            args: {},
            tsNormalized: { ok: true, value: { price: 1 } },
            rustNormalized: { ok: true, value: { price: 2 } },
            tsRaw: { ok: true, value: { price: 1 } },
            rustRaw: { ok: true, value: { price: 2 } },
            tsWire: [{ method: 'POST', url: '/p', status: 200 }],
            rustWire: [{ method: 'POST', url: '/p', status: 200 }],
            path: '/value/price',
          },
        },
      ],
    }
    const path = writeShadowReport(report, dir)
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as ShadowReport
    expect(parsed.results).toHaveLength(3)
    const summary = formatHumanSummary(report)
    expect(summary).toContain('IDENTICAL: 1')
    expect(summary).toContain('SKIPPED: 1')
    expect(summary).toContain('DIVERGED: 1')
    expect(summary).toContain('createProduct')
  })
})
