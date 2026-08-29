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
import { joinRel, tsPackageRel } from '../shared/paths.js'
import {
  formatSupersededReport,
  runSupersededServerTsCheck,
} from './lib/superseded-server-ts-check.js'

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'superseded-server-ts-'))
  const src = joinRel(root, tsPackageRel('server'), 'src')
  mkdirSync(src, { recursive: true })
  for (const [basename, body] of Object.entries(files)) {
    writeFileSync(path.join(src, basename), body)
  }
  return root
}

describe('superseded-server-ts-check fixtures', () => {
  it('fails when webhook-native.ts still exists', () => {
    const root = makeRepo({
      'webhook-native.ts': 'export function verifyWebhookNative() {}\n',
    })
    const issues = runSupersededServerTsCheck(root)
    expect(issues.some(i => i.token === 'webhook-native.ts')).toBe(true)
    expect(formatSupersededReport(issues)).toMatch(/webhook-native/)
    expect(formatSupersededReport(issues)).toMatch(/\.\/native/)
  })

  it('fails when paywall-*-ts files still exist', () => {
    const root = makeRepo({
      'paywall-state-ts.ts': 'export type PaywallState = never\n',
      'paywall-gate-ts.ts': 'export function buildPaywallGate() {}\n',
      'paywall-payload-ts.ts': 'export function paywallErrorToClientPayloadTs() {}\n',
      'ok.ts': 'export const ok = true\n',
    })
    const issues = runSupersededServerTsCheck(root)
    expect(issues.some(i => i.token === 'paywall-state-ts.ts')).toBe(true)
    expect(issues.some(i => i.token === 'paywall-gate-ts.ts')).toBe(true)
    expect(issues.some(i => i.token === 'paywall-payload-ts.ts')).toBe(true)
    expect(formatSupersededReport(issues)).toMatch(/paywall-state-ts/)
  })

  it('fails on verifyWebhookTs, calculateDelayTs, and timingSafeEqual', () => {
    const root = makeRepo({
      'index.ts': 'function verifyWebhookTs() {}\n',
      'edge.ts': 'function timingSafeEqual() {}\n',
      'native-decisions.ts': 'function calculateDelayTs() {}\n',
    })
    const issues = runSupersededServerTsCheck(root)
    expect(issues.some(i => i.token === 'verifyWebhookTs')).toBe(true)
    expect(issues.some(i => i.token === 'timingSafeEqual')).toBe(true)
    expect(issues.some(i => i.token === 'calculateDelayTs')).toBe(true)
  })

  it('fails on tsFallback and fetch( in client.ts / native-decisions.ts', () => {
    const root = makeRepo({
      'client.ts':
        'async function dispatchClient(tsFallback) { return tsFallback(); await fetch(url) }\n',
      'native-decisions.ts': 'function dispatchSync(tsFallback) { return tsFallback() }\n',
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
      'native-decisions.ts':
        "import { x } from './paywall-state-ts'\n// Paywall/retry TS bodies remain until Step 53.\n",
    })
    const issues = runSupersededServerTsCheck(root)
    expect(issues.some(i => i.token === 'paywall-*-ts import')).toBe(true)
    expect(issues.some(i => i.token === 'Step 53 TS fallback comment')).toBe(true)
  })

  it('passes a clean Rust-only server src tree', () => {
    const root = makeRepo({
      'client.ts': 'export async function dispatchClient() { return callNative() }\n',
      'native-decisions.ts':
        'export function dispatchSync() { throw new Error("server sync API not installed") }\n',
      'index.ts': 'export function verifyWebhook(o) { return verifyWebhookNative(o) }\n',
      'edge.ts': 'export async function verifyWebhook(o) { return verifyWebhookWasm(o) }\n',
      'utils.ts': 'export async function withRetry(fn) { return fn() }\n',
    })
    expect(runSupersededServerTsCheck(root)).toEqual([])
    expect(formatSupersededReport([])).toBe('server-superseded-ts:check: OK')
  })
})
