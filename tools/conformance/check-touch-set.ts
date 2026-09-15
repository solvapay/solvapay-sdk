#!/usr/bin/env tsx
/**
 * Touch-set gate: a new core helper + manifest entry + fixture must ship through
 * generated files only. Hand-maintained barrels, residue, and MCP dispatch tables
 * must not require an extra edit.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../shared/paths.js'

const INDEX_REL = 'sdks/typescript/core/src/index.ts'
const BARREL_REL = 'sdks/typescript/core/src/barrel.generated.ts'
const SYNC_DISPATCH_REL = 'core/solvapay-mcp/src/sync_dispatch.rs'
const SYNC_DISPATCH_GEN_REL = 'core/solvapay-mcp/src/sync_dispatch.generated.rs'

export function checkTouchSet({
  indexSrc,
  barrelSrc,
  syncDispatchSrc,
  syncDispatchGeneratedSrc,
}: {
  indexSrc: string
  barrelSrc: string
  syncDispatchSrc: string
  syncDispatchGeneratedSrc: string
}): string | undefined {
  if (
    !indexSrc.includes("from './barrel.generated'") &&
    !indexSrc.includes('from "./barrel.generated"')
  ) {
    return `${INDEX_REL} must re-export generated helpers from barrel.generated.ts`
  }
  if (
    !barrelSrc.includes("from './native-helpers'") &&
    !barrelSrc.includes('from "./native-helpers"')
  ) {
    return `${BARREL_REL} must re-export native-helpers so new core helpers ship without a hand barrel edit`
  }
  if (barrelSrc.includes('export function') || barrelSrc.includes('export const')) {
    return `${BARREL_REL} must stay a re-export barrel; putting helper bodies there reintroduces a TS-only hand edit`
  }
  if (!syncDispatchGeneratedSrc.includes('@generated')) {
    return `${SYNC_DISPATCH_GEN_REL} must be dto-gen output so a new MCP sync op does not need a hand match arm`
  }
  if (!syncDispatchSrc.includes('include!("sync_dispatch.generated.rs")')) {
    return `${SYNC_DISPATCH_REL} must include generated dispatch; a hand-edited match table is a touch-set leak`
  }
  return undefined
}

function main(): void {
  const indexSrc = readFileSync(path.join(REPO_ROOT, INDEX_REL), 'utf8')
  const barrelSrc = readFileSync(path.join(REPO_ROOT, BARREL_REL), 'utf8')
  const syncDispatchSrc = readFileSync(path.join(REPO_ROOT, SYNC_DISPATCH_REL), 'utf8')
  const syncDispatchGeneratedSrc = readFileSync(path.join(REPO_ROOT, SYNC_DISPATCH_GEN_REL), 'utf8')
  const error = checkTouchSet({
    indexSrc,
    barrelSrc,
    syncDispatchSrc,
    syncDispatchGeneratedSrc,
  })
  if (error) {
    console.error(error)
    process.exit(1)
  }
  console.log(
    `touch-set: ${INDEX_REL} → ${BARREL_REL}; ${SYNC_DISPATCH_REL} includes generated dispatch`,
  )
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]).endsWith('check-touch-set.ts')
if (isDirectRun) {
  main()
}
