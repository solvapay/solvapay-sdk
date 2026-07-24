/**
 * Step 53 — superseded-server-TS gate unit tests (RED→GREEN).
 *
 * Fixture cases prove the checker fails on forbidden files/tokens. The live
 * tree is checked separately via `pnpm server-superseded-ts:check`.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatSupersededReport,
  runSupersededServerTsCheck,
} from './lib/superseded-server-ts-check.js'

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'superseded-server-ts-'))
  const src = path.join(root, 'packages/server/src')
  mkdirSync(src, { recursive: true })
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

describe('superseded-server-ts-check fixtures', () => {
  it('fails when paywall-*-ts files still exist', () => {
    const root = makeRepo({
      'packages/server/src/paywall-state-ts.ts': 'export type PaywallState = never\n',
      'packages/server/src/paywall-gate-ts.ts': 'export function buildPaywallGate() {}\n',
      'packages/server/src/paywall-payload-ts.ts':
        'export function paywallErrorToClientPayloadTs() {}\n',
      'packages/server/src/ok.ts': 'export const ok = true\n',
    })
    const issues = runSupersededServerTsCheck(root)
    expect(issues.some(i => i.token === 'paywall-state-ts.ts')).toBe(true)
    expect(issues.some(i => i.token === 'paywall-gate-ts.ts')).toBe(true)
    expect(issues.some(i => i.token === 'paywall-payload-ts.ts')).toBe(true)
    expect(formatSupersededReport(issues)).toMatch(/paywall-state-ts/)
  })

  it('fails on verifyWebhookTs, calculateDelayTs, and timingSafeEqual', () => {
    const root = makeRepo({
      'packages/server/src/index.ts': 'function verifyWebhookTs() {}\n',
      'packages/server/src/edge.ts': 'function timingSafeEqual() {}\n',
      'packages/server/src/native-decisions.ts': 'function calculateDelayTs() {}\n',
    })
    const issues = runSupersededServerTsCheck(root)
    expect(issues.some(i => i.token === 'verifyWebhookTs')).toBe(true)
    expect(issues.some(i => i.token === 'timingSafeEqual')).toBe(true)
    expect(issues.some(i => i.token === 'calculateDelayTs')).toBe(true)
  })

  it('fails on tsFallback and fetch( in client.ts / native-decisions.ts', () => {
    const root = makeRepo({
      'packages/server/src/client.ts':
        'async function dispatchClient(tsFallback) { return tsFallback(); await fetch(url) }\n',
      'packages/server/src/native-decisions.ts':
        'function dispatchSync(tsFallback) { return tsFallback() }\n',
    })
    const issues = runSupersededServerTsCheck(root)
    expect(issues.some(i => i.file.endsWith('client.ts') && i.token === 'tsFallback')).toBe(true)
    expect(issues.some(i => i.file.endsWith('client.ts') && i.token === 'fetch(')).toBe(true)
    expect(
      issues.some(i => i.file.endsWith('native-decisions.ts') && i.token === 'tsFallback'),
    ).toBe(true)
  })

  it('fails on paywall-*-ts imports and stale Step 53 fallback comments', () => {
    const root = makeRepo({
      'packages/server/src/native-decisions.ts':
        "import { x } from './paywall-state-ts'\n// Paywall/retry TS bodies remain until Step 53.\n",
    })
    const issues = runSupersededServerTsCheck(root)
    expect(issues.some(i => i.token === 'paywall-*-ts import')).toBe(true)
    expect(issues.some(i => i.token === 'Step 53 TS fallback comment')).toBe(true)
  })

  it('passes a clean Rust-only server src tree', () => {
    const root = makeRepo({
      'packages/server/src/client.ts':
        'export async function dispatchClient() { return callNative() }\n',
      'packages/server/src/native-decisions.ts':
        'export function dispatchSync() { throw new Error("server sync API not installed") }\n',
      'packages/server/src/index.ts':
        'export function verifyWebhook(o) { return verifyWebhookNative(o) }\n',
      'packages/server/src/edge.ts':
        'export async function verifyWebhook(o) { return verifyWebhookWasm(o) }\n',
      'packages/server/src/utils.ts': 'export async function withRetry(fn) { return fn() }\n',
    })
    expect(runSupersededServerTsCheck(root)).toEqual([])
    expect(formatSupersededReport([])).toBe('server-superseded-ts:check: OK')
  })
})
