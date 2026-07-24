/**
 * Offline shadow harness conformance (step 25.5).
 *
 * Runs both drivers against a stub backend with volatile refs/timestamps.
 * Includes an intentional-divergence control that dumps both wire exchanges.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { scenarioOperationCoverage } from '../../contract/shadow/scenarios.js'
import { FACADE_SHADOW_OPERATION_NAMES } from './facade-driver.js'
import {
  printReport,
  reportHasFailures,
  runShadowSuite,
} from './orchestrator.js'
import { startStubBackend, type StubBackend } from './stub-backend.js'
import { SHADOW_SCENARIOS } from '../../contract/shadow/scenarios.js'

describe('shadow selftest (stub backend)', () => {
  let stub: StubBackend
  let divergeStub: StubBackend

  beforeAll(async () => {
    stub = await startStubBackend()
    divergeStub = await startStubBackend({ divergeListPlansPrice: true })
  }, 60_000)

  afterAll(async () => {
    await stub.close()
    await divergeStub.close()
  })

  it('scenario catalog covers all 36 operations', () => {
    const covered = scenarioOperationCoverage()
    for (const op of FACADE_SHADOW_OPERATION_NAMES) {
      expect(covered.has(op), `missing scenario for ${op}`).toBe(true)
    }
  })

  it('runs runnable scenarios IDENTICAL against stub (skips stripe set)', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'shadow-selftest-'))
    const report = await runShadowSuite({
      baseUrl: stub.baseUrl,
      apiKey: 'sk_test_shadow_selftest',
      mode: 'selftest',
      outDir,
    })
    printReport(report)

    const identical = report.results.filter(r => r.status === 'IDENTICAL')
    const skipped = report.results.filter(r => r.status === 'SKIPPED')
    const bad = report.results.filter(
      r => r.status === 'DIVERGED' || r.status === 'ERROR',
    )

    expect(skipped.length).toBeGreaterThan(0)
    expect(skipped.every(s => (s.reason ?? '').includes('requires:'))).toBe(true)
    expect(identical.length).toBeGreaterThan(0)
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([])
    expect(reportHasFailures(report)).toBe(false)
  }, 180_000)

  it('intentional listPlans divergence dumps both wire exchanges', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'shadow-diverge-'))
    const report = await runShadowSuite({
      baseUrl: divergeStub.baseUrl,
      apiKey: 'sk_test_shadow_diverge',
      mode: 'selftest',
      outDir,
      scenarios: SHADOW_SCENARIOS.filter(s => s.id === 'listPlans'),
    })

    const diverged = report.results.filter(r => r.status === 'DIVERGED')
    expect(diverged.length).toBe(1)
    const d = diverged[0]?.divergence
    expect(d).toBeDefined()
    expect(d?.tsWire.length).toBeGreaterThan(0)
    expect(d?.rustWire.length).toBeGreaterThan(0)
    expect(d?.path).toBeTruthy()
  }, 120_000)
})
