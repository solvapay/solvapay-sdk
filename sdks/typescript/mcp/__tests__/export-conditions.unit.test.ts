import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
) as { exports: Record<string, Record<string, string>> }

describe('package export conditions', () => {
  it.each(['.', './fetch'] as const)(
    '%s omits development so wrangler does not load Node sources over workerd',
    subpath => {
      const conditions = Object.keys(pkg.exports[subpath])
      expect(conditions).not.toContain('development')
      for (const name of ['workerd', 'worker', 'edge-light', 'deno'] as const) {
        expect(conditions, name).toContain(name)
      }
      expect(conditions.indexOf('workerd')).toBeLessThan(conditions.indexOf('import'))
    },
  )
})
