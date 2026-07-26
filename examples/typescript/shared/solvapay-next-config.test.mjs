import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import { findMonorepoRoot, withSolvaPayNextConfig } from './solvapay-next-config.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(here, '../../..')

describe('solvapay-next-config', () => {
  it('finds the pnpm workspace root from a nested example config URL', () => {
    const nestedConfigUrl = pathToFileURL(
      resolve(here, '../checkout-demo/next.config.mjs'),
    ).href
    assert.equal(findMonorepoRoot(nestedConfigUrl), workspaceRoot)
  })

  it('externalizes native packages and strips them from transpilePackages', () => {
    const config = withSolvaPayNextConfig(
      {
        transpilePackages: ['@solvapay/react', '@solvapay/server', '@solvapay/next'],
      },
      { importMetaUrl: import.meta.url },
    )

    assert.equal(config.outputFileTracingRoot, workspaceRoot)
    assert.deepEqual(config.transpilePackages, ['@solvapay/react'])
    for (const pkg of [
      '@solvapay/next',
      '@solvapay/server',
      '@solvapay/server-native',
      '@solvapay/server-wasm',
    ]) {
      assert.ok(config.serverExternalPackages.includes(pkg), `missing ${pkg}`)
    }
  })

  it('stubs server-native on the client webpack graph', () => {
    const config = withSolvaPayNextConfig({}, { importMetaUrl: import.meta.url })
    const webpackConfig = {
      resolve: { alias: {}, fallback: {} },
    }
    const next = config.webpack(webpackConfig, { isServer: false })
    assert.equal(next.resolve.alias['@solvapay/server-native'], false)
    assert.equal(next.resolve.fallback.module, false)
    assert.equal(next.resolve.fallback['node:module'], false)
  })
})
