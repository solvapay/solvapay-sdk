#!/usr/bin/env tsx
/**
 * CLI: retired-symbol regression gate (docs + Python/Ruby facade helpers).
 *
 * Usage: pnpm retired-symbols:check
 *        tsx tools/repo/check-retired-symbols.ts
 */

import { formatRetiredSymbolsReport, runRetiredSymbolsCheck } from './lib/retired-symbols.js'
import { REPO_ROOT } from '../shared/paths.js'

const issues = runRetiredSymbolsCheck(REPO_ROOT)
const report = formatRetiredSymbolsReport(issues)
if (issues.length > 0) {
  console.error(report)
  process.exit(1)
}
console.log(report)
