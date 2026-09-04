import { describe, expect, it } from 'vitest'
import {
  FACADES,
  missingReasons,
  parseDtsExports,
  type FacadeCoverageFile,
} from './facade-coverage.js'

describe('facade-coverage', () => {
  it('enumerates the 12 sdks/ facades (wasm split into edge/browser)', () => {
    expect(FACADES).toEqual(expect.arrayContaining(['wasm-edge', 'wasm-browser']))
    expect(FACADES).not.toContain('wasm')
    expect(FACADES).toHaveLength(12)
  })

  it('flags gaps that lack a reason', () => {
    const empty = Object.fromEntries(
      FACADES.map(id => [id, { exposed: true as const }]),
    ) as FacadeCoverageFile['ops'][string]
    empty.capi = { exposed: false, reason: '' }
    const coverage: FacadeCoverageFile = {
      _comment: 'test',
      facades: FACADES,
      ops: { createCustomer: empty },
    }
    expect(missingReasons(coverage)).toEqual(['createCustomer.capi'])
  })

  it('parses exported functions, consts, and class methods from a .d.ts', () => {
    const names = parseDtsExports(`
/**
 * Binding for formatPrice.
 */
export function formatPrice(args_json: string): string;
export const wasmVersion: string;
export class WasmClient {
    free(): void;
    createCustomer(args_json: string): Promise<string>;
}
export function initSync(module: unknown): unknown;
`)
    expect(names.has('formatPrice')).toBe(true)
    expect(names.has('wasmVersion')).toBe(true)
    expect(names.has('createCustomer')).toBe(true)
    expect(names.has('free')).toBe(false)
    expect(names.has('WasmClient')).toBe(false)
  })
})
