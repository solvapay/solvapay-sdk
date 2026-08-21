/**
 * CLI entry for shadow-mode live runs.
 *
 *   SOLVAPAY_SHADOW_BASE_URL=http://localhost:3001 \
 *   SOLVAPAY_SHADOW_API_KEY=sp_sandbox_... \
 *   pnpm shadow:run
 */

import { printReport, reportHasFailures, runShadowSuite } from './orchestrator.js'
import { lookupPath } from '../../shared/repo-paths.js'

async function main(): Promise<void> {
  const baseUrl = process.env.SOLVAPAY_SHADOW_BASE_URL
  const apiKey = process.env.SOLVAPAY_SHADOW_API_KEY
  if (!baseUrl || !apiKey) {
    throw new Error(
      'Set SOLVAPAY_SHADOW_BASE_URL and SOLVAPAY_SHADOW_API_KEY (e.g. http://localhost:3001 + sandbox secret key)',
    )
  }

  const enableRequires = process.env.SOLVAPAY_SHADOW_ENABLE_STRIPE === 'true'
  const report = await runShadowSuite({
    baseUrl,
    apiKey,
    mode: 'live',
    enableRequires,
    outDir: lookupPath('shadowOutput'),
  })
  printReport(report)
  if (reportHasFailures(report)) {
    process.exitCode = 1
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
