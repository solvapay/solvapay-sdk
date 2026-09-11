/**
 * Unit tests for clean-install orchestration (Step 39 RED/GREEN).
 * Uses dependency-injected spawn/filesystem helpers — does not run the
 * full 27-job matrix locally.
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
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
  stageConsumerSmoke,
} from '../scripts/clean-install-lib.mjs'

describe('clean-install orchestrator', () => {
  it('resolves the monorepo root two levels above sdks/node-native', () => {
    const bindingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const repoRoot = resolve(bindingRoot, '../..')
    assert.equal(existsSync(join(repoRoot, 'pnpm-workspace.yaml')), true)
    assert.equal(existsSync(join(repoRoot, 'package.json')), true)
  })

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

  it('fails if native mode is given an unknown target dir', () => {
    assert.throws(
      () =>
        assertModeArtifactIsolation('native', 'wasm32-wasi', {
          packages: { '@solvapay/server-native-wasm32-wasi': { tarball: 'wasi.tgz' } },
        }),
      /Unknown target dir/,
    )
  })

  it('fails if mode is not native', () => {
    assert.throws(
      () =>
        assertModeArtifactIsolation('wasi', 'darwin-arm64', {
          packages: {
            '@solvapay/server-native-darwin-arm64': { tarball: 'native.tgz' },
          },
        }),
      /unknown mode/,
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
    assert.throws(
      () => assertNpmInstallPlan({ command: 'npm.cmd', args: ['install'], cwd: '/x' }),
      /must use npm/,
    )
  })

  it('always plans bare npm and passes shell:true on win32 to spawn', async () => {
    const plan = buildNpmInstallPlan({ consumerDir: '/tmp/empty-consumer', mode: 'native' })
    assert.equal(plan.command, 'npm')

    /** @type {{ shell?: boolean } | undefined} */
    let spawnOpts
    function fakeSpawn(_cmd, _args, opts) {
      spawnOpts = opts
      const ee = new EventEmitter()
      ee.stdout = new EventEmitter()
      ee.stderr = new EventEmitter()
      queueMicrotask(() => {
        ee.emit('close', 0)
      })
      return ee
    }

    await runCaptured(plan, { spawn: fakeSpawn })
    assert.ok(spawnOpts, 'expected spawn to be called')
    assert.equal(spawnOpts.shell, process.platform === 'win32')
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
      },
    }
    const pkg = buildConsumerPackageJson({
      mode: 'native',
      expectedTargetDir: 'darwin-arm64',
      bundleDir: '/bundle',
      manifest,
    })
    assert.ok(pkg.dependencies['@solvapay/server-native-darwin-arm64'])
    for (const name of forbiddenNativeModePackages('darwin-arm64')) {
      assert.equal(pkg.dependencies[name], undefined)
    }
  })

  it('stages client-smoke-fixture alongside the consumer script (37R-e)', () => {
    /** @type {string[]} */
    const copied = []
    const consumerScript = stageConsumerSmoke('/tmp/consumer', {
      mkdirSync: () => {},
      copyFileSync: (src, dest) => {
        copied.push(String(dest).split('/').pop() ?? '')
        void src
      },
    })
    assert.ok(consumerScript.endsWith('clean-install-consumer.mjs'))
    assert.ok(
      copied.includes('client-smoke-fixture.mjs'),
      `expected client-smoke-fixture.mjs in staged files, got: ${copied.join(', ')}`,
    )
    assert.ok(copied.includes('webhook-smoke-fixture.mjs'))
    assert.ok(copied.includes('targets.mjs'))
    assert.ok(copied.includes('support-matrix.json'))
  })

})
