import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
    for (const origin of ['127.0.0.1', 'localhost']) {
      assert.ok(config.allowedDevOrigins.includes(origin), `missing ${origin}`)
    }
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

  it('preserves caller allowedDevOrigins alongside 127.0.0.1 and localhost', () => {
    const config = withSolvaPayNextConfig(
      { allowedDevOrigins: ['checkout.example'] },
      { importMetaUrl: import.meta.url },
    )
    assert.ok(config.allowedDevOrigins.includes('checkout.example'))
    assert.ok(config.allowedDevOrigins.includes('127.0.0.1'))
  })

  it('does not add native-package externals on the client webpack graph', () => {
    const config = withSolvaPayNextConfig({}, { importMetaUrl: import.meta.url })
    const webpackConfig = {
      externals: ['keep-me'],
      resolve: { alias: {}, fallback: {} },
    }
    const next = config.webpack(webpackConfig, { isServer: false })
    assert.deepEqual(next.externals, ['keep-me'])
  })

  it('does not add native-package externals on the edge server webpack graph', () => {
    const config = withSolvaPayNextConfig({}, { importMetaUrl: import.meta.url })
    const webpackConfig = { externals: ['keep-me'] }
    const next = config.webpack(webpackConfig, { isServer: true, nextRuntime: 'edge' })
    assert.deepEqual(next.externals, ['keep-me'])
  })

  it('externalizes native packages as commonjs on the server webpack graph', async () => {
    const config = withSolvaPayNextConfig({}, { importMetaUrl: import.meta.url })
    const webpackConfig = { externals: ['keep-me'] }
    const next = config.webpack(webpackConfig, { isServer: true })

    assert.equal(typeof next.externals[0], 'function')
    assert.deepEqual(next.externals.slice(1), ['keep-me'])

    const externalize = request =>
      new Promise((resolve, reject) => {
        next.externals[0]({ request }, (err, value) => {
          if (err) reject(err)
          else resolve(value)
        })
      })

    assert.equal(await externalize('@solvapay/server'), 'commonjs @solvapay/server')
    assert.equal(await externalize('@solvapay/server-native'), 'commonjs @solvapay/server-native')
    assert.equal(await externalize('@solvapay/next'), 'commonjs @solvapay/next')
    assert.equal(await externalize('react'), undefined)
  })

  it('shadcn and tailwind next configs prefer NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF and drop prd_demo', () => {
    for (const demo of ['shadcn-checkout', 'tailwind-checkout']) {
      const src = readFileSync(resolve(here, `../${demo}/next.config.mjs`), 'utf8')
      assert.match(
        src,
        /NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF:\s*\n\s*process\.env\.NEXT_PUBLIC_SOLVAPAY_PRODUCT_REF/,
      )
      assert.doesNotMatch(src, /prd_demo/)
    }
  })
})
