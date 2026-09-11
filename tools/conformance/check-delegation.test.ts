/**
 * Step 37R-e — node-binding-delegation gate unit tests (RED→GREEN).
 *
 * Fixture cases prove the checker fails on (1) a non-delegating export that is
 * not allowlisted and (2) a stale allowlist symbol. The live tree is checked
 * separately via `pnpm delegation:check`.
 */

import { describe, expect, it } from 'vitest'
import {
  checkDelegation,
  formatDelegationReport,
  hasDelegationMarker,
  type ExportInventoryEntry,
} from './lib/delegation-check.js'

describe('delegation-check fixtures', () => {
  it('fails when an export has no marker and is not allowlisted', () => {
    const inventory: ExportInventoryEntry[] = [
      {
        package: '@solvapay/server',
        symbol: 'orphanHelper',
        definitionFile: '/tmp/orphan.ts',
        sourceText: 'export function orphanHelper() { return 1 }\n',
      },
    ]

    const issues = checkDelegation(inventory, { entries: [] })
    expect(issues.some(i => i.kind === 'missing-marker' && i.symbol === 'orphanHelper')).toBe(true)
    expect(formatDelegationReport(issues)).toMatch(/orphanHelper/)
  })

  it('fails when the allowlist contains a stale symbol', () => {
    const inventory: ExportInventoryEntry[] = [
      {
        package: '@solvapay/core',
        symbol: 'validateBusinessDetails',
        definitionFile: '/tmp/native-core.ts',
        sourceText:
          'export function validateBusinessDetails() { return dispatchSync("x", {}, () => null) }\n',
      },
    ]

    const issues = checkDelegation(inventory, {
      entries: [
        {
          package: '@solvapay/core',
          symbol: 'doesNotExistAnymore',
          reason: 'section-8-exclusion',
        },
      ],
    })

    expect(
      issues.some(i => i.kind === 'stale-allowlist' && i.symbol === 'doesNotExistAnymore'),
    ).toBe(true)
    expect(formatDelegationReport(issues)).toMatch(/doesNotExistAnymore/)
  })

  it('recognizes edge WASM delegation markers (Step 38R-f)', () => {
    expect(hasDelegationMarker('return callWasm(fn, argsJson, config)')).toBe(true)
    expect(hasDelegationMarker('return callWasmSync(fn, argsJson)')).toBe(true)
    expect(hasDelegationMarker('return verifyWebhookWasm(payload, sig, secret)')).toBe(true)

    const inventory: ExportInventoryEntry[] = [
      {
        package: '@solvapay/server',
        symbol: 'verifyWebhookEdge',
        definitionFile: '/tmp/wasm.ts',
        sourceText:
          'export function verifyWebhookEdge() { return verifyWebhookWasm("p", "s", "k") }\n',
      },
    ]
    expect(checkDelegation(inventory, { entries: [] })).toEqual([])
  })

  it('passes a marked export and rejects an invalid allowlist reason', () => {
    expect(hasDelegationMarker('return dispatchClient("getCustomer", params, fn)')).toBe(true)

    const inventory: ExportInventoryEntry[] = [
      {
        package: '@solvapay/server',
        symbol: 'buildPaywallGate',
        definitionFile: '/tmp/native-decisions.ts',
        sourceText:
          'export function buildPaywallGate() { return dispatchSync("x", {}, () => ({})) }\n',
      },
    ]

    const ok = checkDelegation(inventory, { entries: [] })
    expect(ok).toEqual([])

    const badReason = checkDelegation(inventory, {
      entries: [
        {
          package: '@solvapay/server',
          symbol: 'buildPaywallGate',
          reason: 'not-a-real-reason',
        },
      ],
    })
    expect(badReason.some(i => i.kind === 'invalid-reason')).toBe(true)
  })
})
