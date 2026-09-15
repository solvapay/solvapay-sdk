import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

describe('nativeBuildInfo version stamp', () => {
  it('matches the package version and includes coreSha', async () => {
    const { napiVersion, nativeBuildInfo } = await import('../index.js')
    assert.equal(napiVersion(), pkg.version)
    const info = JSON.parse(nativeBuildInfo())
    assert.equal(info.version, pkg.version)
    assert.equal(typeof info.coreSha, 'string')
    assert.ok(info.coreSha.length > 0)
    if (process.env.SOLVAPAY_RELEASE_VERSION) {
      assert.notEqual(info.coreSha, 'unknown')
    }
  })
})
