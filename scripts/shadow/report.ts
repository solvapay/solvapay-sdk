/**
 * Shadow-mode report writer (JSON + human summary).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Divergence } from './compare.js'

export type ScenarioStatus = 'IDENTICAL' | 'SKIPPED' | 'DIVERGED' | 'ERROR'

export type ScenarioResult = {
  op: string
  scenarioId?: string
  status: ScenarioStatus
  reason?: string
  divergence?: Divergence
  error?: string
}

export type ShadowReport = {
  startedAt: string
  finishedAt: string
  baseUrl: string
  mode?: 'live' | 'selftest'
  results: ScenarioResult[]
}

export function writeShadowReport(report: ShadowReport, outDir: string): string {
  mkdirSync(outDir, { recursive: true })
  const path = join(outDir, 'shadow-report.json')
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return path
}

export function formatHumanSummary(report: ShadowReport): string {
  let identical = 0
  let skipped = 0
  let diverged = 0
  let errored = 0
  const skipReasons: string[] = []
  const divergeLines: string[] = []

  for (const r of report.results) {
    switch (r.status) {
      case 'IDENTICAL':
        identical += 1
        break
      case 'SKIPPED':
        skipped += 1
        skipReasons.push(`  - ${r.scenarioId ?? r.op}: ${r.reason ?? 'skipped'}`)
        break
      case 'DIVERGED':
        diverged += 1
        divergeLines.push(
          `  - ${r.scenarioId ?? r.op}: path=${r.divergence?.path ?? '?'}`,
        )
        break
      case 'ERROR':
        errored += 1
        divergeLines.push(`  - ${r.scenarioId ?? r.op}: ERROR ${r.error ?? ''}`)
        break
    }
  }

  const lines = [
    'Shadow-mode summary',
    `  mode: ${report.mode ?? 'live'}`,
    `  baseUrl: ${report.baseUrl}`,
    `  IDENTICAL: ${identical}`,
    `  SKIPPED: ${skipped}`,
    `  DIVERGED: ${diverged}`,
    `  ERROR: ${errored}`,
  ]
  if (skipReasons.length > 0) {
    lines.push('Skipped:')
    lines.push(...skipReasons)
  }
  if (divergeLines.length > 0) {
    lines.push('Divergences / errors:')
    lines.push(...divergeLines)
  }
  return lines.join('\n')
}
