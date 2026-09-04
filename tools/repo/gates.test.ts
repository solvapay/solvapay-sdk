import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lookupPath } from '../shared/repo-paths.js'
import { GATE_SCRIPTS } from './gates.js'

describe('gates task list', () => {
  it('should contain the four step-6 gates in order', () => {
    expect(GATE_SCRIPTS.slice(0, 4)).toEqual([
      'gen:check',
      'manifest:check',
      'parity:check',
      'test:fixtures',
    ])
  })

  it('should map every entry to a script that exists in package.json', () => {
    const raw = JSON.parse(readFileSync(lookupPath('packageJson'), 'utf8')) as {
      scripts: Record<string, string>
    }
    for (const script of GATE_SCRIPTS) {
      expect(raw.scripts[script], script).toBeTypeOf('string')
    }
  })
})
