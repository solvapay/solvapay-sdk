/**
 * Unit tests for clean-install orchestration (Step 39 RED/GREEN).
 * Uses dependency-injected spawn/filesystem helpers — does not run the
 * full 27-job matrix locally.
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import {
  assertChildOk,
  assertEmptyConsumerDir,
  assertModeArtifactIsolation,
  assertNpmInstallPlan,
  assertRequiredTarballs,
  buildConsumerPackageJson,
  buildNpmInstallPlan,
  forbiddenNativeModePackages,
  runCaptured,
} from '../scripts/clean-install-lib.mjs'
import { WASI_TARGET } from '../scripts/targets.mjs'

describe('clean-install orchestrator', () => {
  it('refuses a non-empty consumer directory', () => {
    assert.throws(
      () =>
        assertEmptyConsumerDir('/tmp/consumer', {
          existsSync: () => true,
          readdirSync: () => ['package.json'],
        }),
      /must be empty/,
    )
  })

  it('fails if any required tarball is missing from the manifest', () => {
    const manifest = {
      packages: {
        '@solvapay/core': { tarball: 'core.tgz' },
      },
    }
    assert.throws(
      () =>
        assertRequiredTarballs('/bundle', manifest, ['@solvapay/core', '@solvapay/server'], {
          existsSync: () => true,
        }),
      /missing from manifest: @solvapay\/server/,
    )
  })

  it('fails if a required tarball file is absent on disk', () => {
    const manifest = {
      packages: {
        '@solvapay/server': { tarball: 'server.tgz', sha256: 'aa' },
      },
    }
    assert.throws(
      () =>
        assertRequiredTarballs('/bundle', manifest, ['@solvapay/server'], {
          existsSync: () => false,
        }),
      /tarball file missing/,
    )
  })

  it('fails if native mode is given a WASI artifact as expected target', () => {
    assert.throws(
      () =>
        assertModeArtifactIsolation('native', WASI_TARGET.dir, {
          packages: { [WASI_TARGET.packageName]: { tarball: 'wasi.tgz' } },
        }),
      /native mode must not use WASI/,
    )
  })

  it('fails if WASI mode is given a non-WASI expected target', () => {
    assert.throws(
      () =>
        assertModeArtifactIsolation('wasi', 'darwin-arm64', {
          packages: {
            [WASI_TARGET.packageName]: { tarball: 'wasi.tgz' },
            '@solvapay/server-native-darwin-arm64': { tarball: 'native.tgz' },
          },
        }),
      /wasi mode expected target/,
    )
  })

  it('generates npm install, never pnpm install, and does not use workspace paths', () => {
    const plan = buildNpmInstallPlan(
      { consumerDir: '/tmp/empty-consumer', mode: 'native' },
      {
        existsSync: () => true,
        readdirSync: () => [],
      },
    )
    assert.equal(plan.command, 'npm')
    assert.equal(plan.args[0], 'install')
    assert.ok(plan.args.includes('--ignore-scripts'))
    assert.ok(!plan.args.includes('ci'))
    assertNpmInstallPlan(plan)
    assert.throws(
      () => assertNpmInstallPlan({ command: 'pnpm', args: ['install'], cwd: '/x' }),
      /must use npm/,
    )
  })

  it('propagates the child install exit code and includes stdout/stderr in the error', async () => {
    const plan = {
      command: 'npm',
      args: ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      cwd: '/tmp/empty',
      env: process.env,
    }

    function fakeSpawn() {
      const ee = new EventEmitter()
      ee.stdout = new EventEmitter()
      ee.stderr = new EventEmitter()
      queueMicrotask(() => {
        ee.stdout.emit('data', 'out-line')
        ee.stderr.emit('data', 'err-line')
        ee.emit('close', 17)
      })
      return ee
    }

    const result = await runCaptured(plan, { spawn: fakeSpawn })
    assert.equal(result.code, 17)
    assert.match(result.stdout, /out-line/)
    assert.match(result.stderr, /err-line/)
    assert.throws(() => assertChildOk(result, 'npm install'), /exit 17[\s\S]*out-line[\s\S]*err-line/)
  })

  it('builds consumer package.json with only the expected native target tarball', () => {
    const manifest = {
      packages: {
        '@solvapay/core': { tarball: 'core.tgz' },
        '@solvapay/server-wasm': { tarball: 'wasm.tgz' },
        '@solvapay/server-native': { tarball: 'loader.tgz' },
        '@solvapay/server': { tarball: 'server.tgz' },
        '@solvapay/server-native-darwin-arm64': { tarball: 'darwin-arm64.tgz' },
        '@solvapay/server-native-wasm32-wasi': { tarball: 'wasi.tgz' },
      },
    }
    const pkg = buildConsumerPackageJson({
      mode: 'native',
      expectedTargetDir: 'darwin-arm64',
      bundleDir: '/bundle',
      manifest,
    })
    assert.ok(pkg.dependencies['@solvapay/server-native-darwin-arm64'])
    assert.equal(pkg.dependencies['@solvapay/server-native-wasm32-wasi'], undefined)
    for (const name of forbiddenNativeModePackages('darwin-arm64')) {
      if (name === '@solvapay/server-native-wasm32-wasi') {
        assert.equal(pkg.dependencies[name], undefined)
      }
    }
  })

  it('builds WASI consumer package.json without native target packages', () => {
    const manifest = {
      packages: {
        '@solvapay/core': { tarball: 'core.tgz' },
        '@solvapay/server-wasm': { tarball: 'wasm.tgz' },
        '@solvapay/server-native': { tarball: 'loader.tgz' },
        '@solvapay/server': { tarball: 'server.tgz' },
        '@solvapay/server-native-darwin-arm64': { tarball: 'darwin-arm64.tgz' },
        '@solvapay/server-native-wasm32-wasi': { tarball: 'wasi.tgz' },
      },
    }
    const pkg = buildConsumerPackageJson({
      mode: 'wasi',
      expectedTargetDir: 'wasm32-wasi',
      bundleDir: '/bundle',
      manifest,
    })
    assert.ok(pkg.dependencies['@solvapay/server-native-wasm32-wasi'])
    assert.equal(pkg.dependencies['@solvapay/server-native-darwin-arm64'], undefined)
    const plan = buildNpmInstallPlan(
      { consumerDir: '/tmp/empty', mode: 'wasi' },
      { existsSync: () => true, readdirSync: () => [] },
    )
    assert.ok(plan.args.includes('--cpu'))
    assert.ok(plan.args.includes('wasm32'))
    assert.ok(plan.args.includes('--force'))
    assert.equal(plan.env?.npm_config_cpu, 'wasm32')
  })
})
