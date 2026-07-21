/**
 * Injectable clean-install orchestration (Step 39).
 *
 * Keeps package assembly, npm install, and consumer smoke as separate
 * functions with explicit inputs so unit tests can DI spawn/fs helpers.
 */

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn as defaultSpawn } from 'node:child_process'
import {
  ALL_TARGETS,
  CORE_PACKAGE_NAME,
  FACADE_PACKAGE_NAME,
  LOADER_PACKAGE_NAME,
  NATIVE_TARGETS,
  SERVER_WASM_PACKAGE_NAME,
  WASI_TARGET,
  targetByDir,
} from './targets.mjs'

/** @typedef {'native' | 'wasi'} CleanInstallMode */

/**
 * @typedef {{
 *   spawn?: typeof defaultSpawn
 *   mkdtempSync?: typeof mkdtempSync
 *   mkdirSync?: typeof mkdirSync
 *   copyFileSync?: typeof copyFileSync
 *   writeFileSync?: typeof writeFileSync
 *   readFileSync?: typeof readFileSync
 *   existsSync?: typeof existsSync
 *   readdirSync?: typeof readdirSync
 *   rmSync?: typeof rmSync
 *   tmpdir?: typeof tmpdir
 * }} FsSpawn
 */

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Stage consumer smoke helpers into the temp project so module resolution
 * cannot walk into the monorepo.
 * @param {string} consumerDir
 * @param {FsSpawn} [fs]
 * @returns {string} path to staged consumer script
 */
export function stageConsumerSmoke(consumerDir, fs = {}) {
  const mkdir = fs.mkdirSync ?? mkdirSync
  const copy = fs.copyFileSync ?? copyFileSync
  const smokeDir = join(consumerDir, '.solvapay-smoke')
  mkdir(smokeDir, { recursive: true })
  for (const name of [
    'clean-install-consumer.mjs',
    'webhook-smoke-fixture.mjs',
    'client-smoke-fixture.mjs',
    'targets.mjs',
  ]) {
    copy(join(SCRIPTS_DIR, name), join(smokeDir, name))
  }
  return join(smokeDir, 'clean-install-consumer.mjs')
}

/**
 * @param {string} consumerDir
 * @param {FsSpawn} [fs]
 */
export function assertEmptyConsumerDir(consumerDir, fs = {}) {
  const exists = fs.existsSync ?? existsSync
  const readdir = fs.readdirSync ?? readdirSync
  if (!exists(consumerDir)) return
  const entries = readdir(consumerDir)
  if (entries.length > 0) {
    throw new Error(
      `clean-install: consumer directory must be empty: ${consumerDir} (found ${entries.join(', ')})`,
    )
  }
}

/**
 * @param {string} bundleDir
 * @param {object} manifest
 * @param {string[]} requiredPackageNames
 * @param {FsSpawn} [fs]
 */
export function assertRequiredTarballs(bundleDir, manifest, requiredPackageNames, fs = {}) {
  const exists = fs.existsSync ?? existsSync
  const read = fs.readFileSync ?? readFileSync
  const packages = manifest?.packages
  if (!packages || typeof packages !== 'object') {
    throw new Error('clean-install: bundle manifest missing packages map')
  }

  for (const name of requiredPackageNames) {
    const entry = packages[name]
    if (!entry?.tarball) {
      throw new Error(`clean-install: required tarball missing from manifest: ${name}`)
    }
    const abs = resolve(bundleDir, entry.tarball)
    if (!exists(abs)) {
      throw new Error(`clean-install: required tarball file missing: ${abs}`)
    }
    if (entry.sha256) {
      const digest = createHash('sha256').update(read(abs)).digest('hex')
      if (digest !== entry.sha256) {
        throw new Error(
          `clean-install: sha256 mismatch for ${name}: expected ${entry.sha256}, got ${digest}`,
        )
      }
    }
  }
}

/**
 * @param {CleanInstallMode} mode
 * @param {string} expectedTargetDir
 * @param {object} manifest
 */
export function assertModeArtifactIsolation(mode, expectedTargetDir, manifest) {
  const packages = manifest?.packages ?? {}
  const nativeNames = NATIVE_TARGETS.map(t => t.packageName)
  const wasiName = WASI_TARGET.packageName

  if (mode === 'native') {
    if (expectedTargetDir === WASI_TARGET.dir) {
      throw new Error('clean-install: native mode must not use WASI target')
    }
    targetByDir(expectedTargetDir)
    if (packages[wasiName]) {
      // Allowed in the immutable full bundle; installer must omit it from consumer deps.
    }
    const expectedPkg = targetByDir(expectedTargetDir).packageName
    if (!packages[expectedPkg]) {
      throw new Error(`clean-install: native mode missing expected target package: ${expectedPkg}`)
    }
    return
  }

  if (mode === 'wasi') {
    if (expectedTargetDir !== WASI_TARGET.dir) {
      throw new Error(`clean-install: wasi mode expected target ${WASI_TARGET.dir}`)
    }
    if (!packages[wasiName]) {
      throw new Error(`clean-install: wasi mode missing ${wasiName} tarball`)
    }
    // Native packages may exist in the full immutable bundle; the installer
    // must omit them from the consumer package.json (see buildConsumerPackageJson).
    void nativeNames
    return
  }

  throw new Error(`clean-install: unknown mode ${mode}`)
}

/**
 * Build the minimal private package.json for a fresh consumer install.
 *
 * @param {{
 *   mode: CleanInstallMode
 *   expectedTargetDir: string
 *   bundleDir: string
 *   manifest: object
 * }} opts
 */
export function buildConsumerPackageJson({ mode, expectedTargetDir, bundleDir, manifest }) {
  const packages = manifest.packages
  const deps = {
    [CORE_PACKAGE_NAME]: tarballFileDep(bundleDir, packages[CORE_PACKAGE_NAME].tarball),
    [SERVER_WASM_PACKAGE_NAME]: tarballFileDep(
      bundleDir,
      packages[SERVER_WASM_PACKAGE_NAME].tarball,
    ),
    [LOADER_PACKAGE_NAME]: tarballFileDep(bundleDir, packages[LOADER_PACKAGE_NAME].tarball),
    [FACADE_PACKAGE_NAME]: tarballFileDep(bundleDir, packages[FACADE_PACKAGE_NAME].tarball),
  }

  if (mode === 'native') {
    const target = targetByDir(expectedTargetDir)
    deps[target.packageName] = tarballFileDep(bundleDir, packages[target.packageName].tarball)
  } else {
    deps[WASI_TARGET.packageName] = tarballFileDep(
      bundleDir,
      packages[WASI_TARGET.packageName].tarball,
    )
  }

  return {
    name: 'solvapay-clean-install-consumer',
    private: true,
    type: 'module',
    dependencies: deps,
  }
}

/**
 * @param {string} bundleDir
 * @param {string} relativeTarball
 */
function tarballFileDep(bundleDir, relativeTarball) {
  // Absolute file: URLs break on some npm versions; use absolute path form.
  return `file:${resolve(bundleDir, relativeTarball)}`
}

/**
 * @param {{
 *   consumerDir: string
 *   mode: CleanInstallMode
 *   npmArgs?: string[]
 * }} opts
 * @param {FsSpawn} [fs]
 * @returns {{ command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv }}
 */
export function buildNpmInstallPlan({ consumerDir, mode, npmArgs = [] }, _fs = {}) {
  const args = [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    ...npmArgs,
  ]

  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    npm_config_package_lock: 'false',
  }

  // WASI package declares cpu: ["wasm32"]; npm skips it on host CPUs unless forced.
  // Prefer npm_config_cpu + --force so EBADPLATFORM cannot hide a missing tarball
  // behind a silent optional skip (the package is a direct dependency here).
  if (mode === 'wasi') {
    args.push('--cpu', 'wasm32', '--force')
    env.npm_config_cpu = 'wasm32'
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
    cwd: consumerDir,
    env,
  }
}

/**
 * Refuse pnpm / workspace install paths.
 * @param {{ command: string, args: string[], cwd: string }} plan
 */
export function assertNpmInstallPlan(plan) {
  if (plan.command !== 'npm' && plan.command !== 'npm.cmd') {
    throw new Error(`clean-install: must use npm, got command=${plan.command}`)
  }
  if (plan.args[0] !== 'install') {
    throw new Error(`clean-install: must use npm install, got ${plan.args.join(' ')}`)
  }
  if (plan.args.includes('ci')) {
    throw new Error('clean-install: must not use npm ci (no pre-existing lockfile)')
  }
  const joined = plan.args.join(' ')
  if (joined.includes('workspace:') || joined.includes('pnpm')) {
    throw new Error('clean-install: must not use workspace paths or pnpm')
  }
}

/**
 * @param {{
 *   command: string
 *   args: string[]
 *   cwd: string
 *   env?: NodeJS.ProcessEnv
 * }} plan
 * @param {FsSpawn} [fs]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runCaptured(plan, fs = {}) {
  const spawn = fs.spawn ?? defaultSpawn
  assertNpmInstallPlan(plan)

  return new Promise((resolvePromise, reject) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', code => {
      resolvePromise({ code: code ?? 1, stdout, stderr })
    })
  })
}

/**
 * Propagate a non-zero child exit with stdout/stderr in the Error.
 * @param {{ code: number, stdout: string, stderr: string }} result
 * @param {string} label
 */
export function assertChildOk(result, label) {
  if (result.code === 0) return
  const err = new Error(
    `${label} failed with exit ${result.code}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
  )
  Object.assign(err, {
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  })
  throw err
}

/**
 * @param {{
 *   mode: CleanInstallMode
 *   expectedTargetDir: string
 *   bundleDir: string
 *   manifest: object
 *   preserveOnFailure?: boolean
 *   nodeMajor?: string
 * }} opts
 * @param {FsSpawn} [fs]
 */
export async function runCleanInstallSmoke(opts, fs = {}) {
  const {
    mode,
    expectedTargetDir,
    bundleDir,
    manifest,
    preserveOnFailure = false,
    nodeMajor,
  } = opts

  const mkdtemp = fs.mkdtempSync ?? mkdtempSync
  const write = fs.writeFileSync ?? writeFileSync
  const rm = fs.rmSync ?? rmSync
  const tmp = fs.tmpdir ?? tmpdir

  assertModeArtifactIsolation(mode, expectedTargetDir, manifest)

  const required = [
    CORE_PACKAGE_NAME,
    SERVER_WASM_PACKAGE_NAME,
    LOADER_PACKAGE_NAME,
    FACADE_PACKAGE_NAME,
    mode === 'native'
      ? targetByDir(expectedTargetDir).packageName
      : WASI_TARGET.packageName,
  ]
  assertRequiredTarballs(bundleDir, manifest, required, fs)

  const consumerDir = mkdtemp(join(tmp(), 'solvapay-clean-install-'))
  let failed = false

  try {
    assertEmptyConsumerDir(consumerDir, fs)
    const pkg = buildConsumerPackageJson({
      mode,
      expectedTargetDir,
      bundleDir,
      manifest,
    })
    write(join(consumerDir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

    const installPlan = buildNpmInstallPlan({ consumerDir, mode }, fs)
    assertNpmInstallPlan(installPlan)
    const installResult = await runCaptured(installPlan, fs)
    assertChildOk(installResult, 'npm install')

    const consumerScriptPath = stageConsumerSmoke(consumerDir, fs)

    const target = mode === 'native' ? targetByDir(expectedTargetDir) : WASI_TARGET
    const smokeEnv = {
      ...process.env,
      SOLVAPAY_IMPL: 'rust',
      NAPI_RS_ENFORCE_VERSION_CHECK: '1',
      CLEAN_INSTALL_MODE: mode,
      CLEAN_INSTALL_EXPECTED_TARGET: target.dir,
      CLEAN_INSTALL_EXPECTED_PACKAGE: target.packageName,
      CLEAN_INSTALL_EXPECTED_PLATFORM: target.platform === 'wasi' ? process.platform : target.platform,
      CLEAN_INSTALL_EXPECTED_ARCH: target.platform === 'wasi' ? process.arch : target.arch,
      CLEAN_INSTALL_EXPECTED_LIBC: target.libc ?? '',
      CLEAN_INSTALL_EXPECTED_NODE_MAJOR: nodeMajor ?? String(process.versions.node.split('.')[0]),
      CLEAN_INSTALL_CONSUMER_ROOT: consumerDir,
    }

    if (mode === 'native') {
      delete smokeEnv.NAPI_RS_FORCE_WASI
    } else {
      smokeEnv.NAPI_RS_FORCE_WASI = 'error'
    }

    const smokePlan = {
      command: process.execPath,
      args: [consumerScriptPath],
      cwd: consumerDir,
      env: smokeEnv,
    }

    // Smoke uses node directly — bypass npm-install plan assertion.
    const spawn = fs.spawn ?? defaultSpawn
    const smokeResult = await new Promise((resolvePromise, reject) => {
      const child = spawn(smokePlan.command, smokePlan.args, {
        cwd: smokePlan.cwd,
        env: smokePlan.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', chunk => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', chunk => {
        stderr += String(chunk)
      })
      child.on('error', reject)
      child.on('close', code => {
        resolvePromise({ code: code ?? 1, stdout, stderr })
      })
    })

    try {
      assertChildOk(smokeResult, 'clean-install consumer')
    } catch (err) {
      failed = true
      Object.assign(err, { consumerDir, mode, target: expectedTargetDir })
      throw err
    }

    process.stdout.write(smokeResult.stdout)
    if (smokeResult.stderr) process.stderr.write(smokeResult.stderr)
    return { consumerDir, stdout: smokeResult.stdout, stderr: smokeResult.stderr }
  } catch (err) {
    failed = true
    if (preserveOnFailure) {
      console.error(`clean-install: preserved failing consumer dir: ${consumerDir}`)
    }
    throw err
  } finally {
    if (!failed || !preserveOnFailure) {
      try {
        rm(consumerDir, { recursive: true, force: true })
      } catch {
        // best-effort cleanup
      }
    }
  }
}

/**
 * Packages that a native-mode consumer must NOT receive as installable deps.
 * @param {string} expectedTargetDir
 */
export function forbiddenNativeModePackages(expectedTargetDir) {
  const expected = targetByDir(expectedTargetDir).packageName
  return ALL_TARGETS.filter(t => t.packageName !== expected).map(t => t.packageName)
}

export { ALL_TARGETS, NATIVE_TARGETS, WASI_TARGET, targetByDir }
