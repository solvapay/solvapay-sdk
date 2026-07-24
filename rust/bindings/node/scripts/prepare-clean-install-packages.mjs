#!/usr/bin/env node
/**
 * Assemble publish-shaped tarball bundle for Step 39 clean-install smoke.
 *
 * Expects Step 36 artifacts already placed under npm/<dir>/ (via `napi artifacts`).
 * Does not publish to the registry.
 *
 * Usage:
 *   node scripts/prepare-clean-install-packages.mjs --out-dir <dir>
 *   node scripts/prepare-clean-install-packages.mjs --out-dir <dir> --targets darwin-arm64,wasm32-wasi
 *   node scripts/prepare-clean-install-packages.mjs --out-dir <dir> --skip-js-build
 */

import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  ALL_TARGETS,
  CORE_PACKAGE_NAME,
  FACADE_PACKAGE_NAME,
  LOADER_PACKAGE_NAME,
  SERVER_WASM_PACKAGE_NAME,
  WASI_TARGET,
  targetByDir,
} from './targets.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BINDING_ROOT = join(__dirname, '..')
const REPO_ROOT = resolve(BINDING_ROOT, '../../..')

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {string | null} */
  let outDir = null
  /** @type {string[] | null} */
  let targets = null
  let skipJsBuild = false
  let requireAll = true

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--out-dir' && argv[i + 1]) {
      outDir = resolve(argv[++i])
    } else if (arg === '--targets' && argv[i + 1]) {
      targets = argv[++i].split(',').map(s => s.trim()).filter(Boolean)
      requireAll = false
    } else if (arg === '--skip-js-build') {
      skipJsBuild = true
    } else if (arg === '--require-all') {
      requireAll = true
    } else if (arg === '--allow-partial') {
      requireAll = false
    }
  }

  if (!outDir) {
    throw new Error('prepare-clean-install-packages: --out-dir <dir> is required')
  }

  return { outDir, targets, skipJsBuild, requireAll }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 */
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (exit ${result.status})\n` +
        `--- stdout ---\n${result.stdout ?? ''}\n--- stderr ---\n${result.stderr ?? ''}`,
    )
  }
  return result
}

/**
 * @param {string} filePath
 */
function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

/**
 * @param {import('./targets.mjs').TargetSpec[]} selected
 */
function assertArtifactsPresent(selected) {
  const missing = []
  for (const t of selected) {
    const dirPath = join(BINDING_ROOT, 'npm', t.dir)
    const binaryPath = join(dirPath, t.binary)
    if (!existsSync(binaryPath) || !statSync(binaryPath).isFile()) {
      // Accept a single matching extension in the dir (napi artifacts layout).
      if (!existsSync(dirPath)) {
        missing.push(`${t.dir}/ (directory)`)
        continue
      }
      const files = readdirSync(dirPath).filter(f =>
        t.kind === 'wasm' ? f.endsWith('.wasm') : f.endsWith('.node'),
      )
      if (files.length !== 1) {
        missing.push(`${t.dir}/${t.binary}`)
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `prepare-clean-install-packages: missing artifacts:\n  - ${missing.join('\n  - ')}`,
    )
  }
}

/**
 * Rewrite loader optionalDependencies to publish-shaped version pins.
 * @param {string} version
 */
function buildPublishShapedLoaderManifest(version) {
  const src = JSON.parse(readFileSync(join(BINDING_ROOT, 'package.json'), 'utf8'))
  /** @type {Record<string, string>} */
  const optionalDependencies = {}
  for (const t of ALL_TARGETS) {
    optionalDependencies[t.packageName] = version
  }
  return {
    name: src.name,
    version,
    description: src.description,
    main: src.main,
    types: src.types,
    browser: src.browser,
    files: src.files,
    engines: src.engines,
    license: src.license,
    dependencies: src.dependencies,
    optionalDependencies,
  }
}

/**
 * @param {string} outDir
 * @param {string} version
 */
function packLoader(outDir, version) {
  const staging = mkdtempSync(join(tmpdir(), 'solvapay-loader-pack-'))
  try {
    const manifest = buildPublishShapedLoaderManifest(version)
    writeFileSync(join(staging, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    for (const file of ['index.js', 'index.d.ts', 'browser.js']) {
      const src = join(BINDING_ROOT, file)
      if (!existsSync(src)) {
        throw new Error(`prepare-clean-install-packages: loader file missing: ${file}`)
      }
      cpSync(src, join(staging, file))
    }
    // Reject residual workspace / file: specs in the export manifest.
    const exported = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'))
    for (const [name, spec] of Object.entries(exported.optionalDependencies ?? {})) {
      if (typeof spec !== 'string' || spec.includes('workspace:') || spec.startsWith('file:')) {
        throw new Error(
          `prepare-clean-install-packages: non-publish optionalDependency ${name}=${spec}`,
        )
      }
    }
    run('npm', ['pack', '--pack-destination', outDir], staging)
    return findPackedTarball(outDir, LOADER_PACKAGE_NAME)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * @param {string} outDir
 * @param {import('./targets.mjs').TargetSpec} target
 */
function packTarget(outDir, target) {
  const dir = join(BINDING_ROOT, 'npm', target.dir)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  if (pkg.name !== target.packageName) {
    throw new Error(
      `prepare-clean-install-packages: package name mismatch in ${target.dir}: ${pkg.name}`,
    )
  }
  // Ensure expected binary is present in the packed files list.
  if (Array.isArray(pkg.files) && !pkg.files.includes(target.binary) && target.kind === 'node') {
    // Some targets list only the binary — OK if present on disk.
  }
  if (!existsSync(join(dir, target.binary)) && target.kind === 'node') {
    const nodes = readdirSync(dir).filter(f => f.endsWith('.node'))
    if (nodes.length !== 1) {
      throw new Error(`prepare-clean-install-packages: missing binary for ${target.dir}`)
    }
  }
  if (target.dir === WASI_TARGET.dir) {
    for (const required of [
      'server-native.wasm32-wasi.wasm',
      'server-native.wasi.cjs',
      'wasi-worker.mjs',
    ]) {
      if (!existsSync(join(dir, required))) {
        throw new Error(`prepare-clean-install-packages: WASI support file missing: ${required}`)
      }
    }
  }
  run('npm', ['pack', '--pack-destination', outDir], dir)
  return findPackedTarball(outDir, target.packageName)
}

/**
 * Locate `scope-name-<semver>.tgz` without matching longer names that share a
 * prefix (e.g. `solvapay-server-` must not match `solvapay-server-wasm-`).
 * @param {string} outDir
 * @param {string} packageName
 */
function findPackedTarball(outDir, packageName) {
  const slug = packageName.replace('@', '').replace('/', '-')
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`^${escaped}-\\d`)
  const matches = readdirSync(outDir)
    .filter(f => re.test(f) && f.endsWith('.tgz'))
    .sort()
  if (matches.length === 0) {
    throw new Error(
      `prepare-clean-install-packages: no tarball for ${packageName} (${slug}-*.tgz) in ${outDir}`,
    )
  }
  return matches[matches.length - 1]
}

/** @type {Record<string, string>} */
const WORKSPACE_PACKAGE_DIRS = {
  [CORE_PACKAGE_NAME]: join(REPO_ROOT, 'packages/core'),
  [SERVER_WASM_PACKAGE_NAME]: join(REPO_ROOT, 'rust/bindings/wasm'),
  [FACADE_PACKAGE_NAME]: join(REPO_ROOT, 'packages/server'),
}

/**
 * Pack a workspace package from its directory (pnpm 9 rejects
 * `pnpm --filter <pkg> pack` with an obscure recursive option error).
 * @param {string} outDir
 * @param {string} packageName
 */
function pnpmPack(outDir, packageName) {
  const pkgDir = WORKSPACE_PACKAGE_DIRS[packageName]
  if (!pkgDir) {
    throw new Error(`prepare-clean-install-packages: unknown workspace package ${packageName}`)
  }
  run('pnpm', ['pack', '--pack-destination', outDir], pkgDir)
  return findPackedTarball(outDir, packageName)
}

/**
 * @param {string} tarballPath
 * @param {string} expectedName
 */
function assertNoWorkspaceSpecInTarball(tarballPath, expectedName) {
  const listing = spawnSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
  if (listing.status !== 0) {
    throw new Error(`prepare-clean-install-packages: cannot list ${tarballPath}`)
  }
  if (!listing.stdout.includes('package/package.json')) {
    throw new Error(`prepare-clean-install-packages: package.json missing in ${tarballPath}`)
  }
  const extracted = spawnSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
    encoding: 'utf8',
  })
  if (extracted.status !== 0) {
    throw new Error(`prepare-clean-install-packages: cannot read package.json from ${tarballPath}`)
  }
  const pkg = JSON.parse(extracted.stdout)
  if (pkg.name !== expectedName) {
    throw new Error(
      `prepare-clean-install-packages: expected name ${expectedName}, got ${pkg.name}`,
    )
  }
  const blob = JSON.stringify(pkg)
  if (blob.includes('workspace:')) {
    throw new Error(
      `prepare-clean-install-packages: tarball still contains workspace: specifiers: ${tarballPath}`,
    )
  }
  if (blob.includes(REPO_ROOT) || blob.includes(BINDING_ROOT)) {
    throw new Error(
      `prepare-clean-install-packages: tarball embeds absolute source paths: ${tarballPath}`,
    )
  }
  return pkg
}

function main() {
  const { outDir, targets, skipJsBuild, requireAll } = parseArgs(process.argv.slice(2))
  mkdirSync(outDir, { recursive: true })

  /** @type {import('./targets.mjs').TargetSpec[]} */
  let selected
  if (targets) {
    selected = targets.map(targetByDir)
  } else {
    selected = [...ALL_TARGETS]
  }

  if (requireAll && selected.length !== ALL_TARGETS.length) {
    throw new Error('prepare-clean-install-packages: --require-all needs all 9 targets')
  }
  if (requireAll) {
    // Prefer the hard gate script for the full matrix.
    run(process.execPath, [join(__dirname, 'check-artifacts.mjs')], BINDING_ROOT)
  } else {
    assertArtifactsPresent(selected)
  }

  const loaderPkg = JSON.parse(readFileSync(join(BINDING_ROOT, 'package.json'), 'utf8'))
  const version = loaderPkg.version
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('prepare-clean-install-packages: loader version missing')
  }

  // Ensure loader JS binding files exist (generated by napi build / CI download).
  for (const file of ['index.js', 'index.d.ts', 'browser.js']) {
    if (!existsSync(join(BINDING_ROOT, file))) {
      throw new Error(
        `prepare-clean-install-packages: ${file} missing — run napi build or restore CI artifacts`,
      )
    }
  }

  if (!skipJsBuild) {
    run('pnpm', ['install', '--frozen-lockfile'], REPO_ROOT)
    run('pnpm', ['--filter', CORE_PACKAGE_NAME, 'build'], REPO_ROOT)
    run('pnpm', ['--filter', SERVER_WASM_PACKAGE_NAME, 'build'], REPO_ROOT)
    run('pnpm', ['--filter', FACADE_PACKAGE_NAME, 'build'], REPO_ROOT)
  }

  /** @type {Record<string, { tarball: string, sha256: string, version: string }>} */
  const packages = {}

  const coreTgz = pnpmPack(outDir, CORE_PACKAGE_NAME)
  const corePkg = assertNoWorkspaceSpecInTarball(join(outDir, coreTgz), CORE_PACKAGE_NAME)
  packages[CORE_PACKAGE_NAME] = {
    tarball: coreTgz,
    sha256: sha256File(join(outDir, coreTgz)),
    version: corePkg.version,
  }

  const wasmTgz = pnpmPack(outDir, SERVER_WASM_PACKAGE_NAME)
  const wasmPkg = assertNoWorkspaceSpecInTarball(join(outDir, wasmTgz), SERVER_WASM_PACKAGE_NAME)
  packages[SERVER_WASM_PACKAGE_NAME] = {
    tarball: wasmTgz,
    sha256: sha256File(join(outDir, wasmTgz)),
    version: wasmPkg.version,
  }

  const facadeTgz = pnpmPack(outDir, FACADE_PACKAGE_NAME)
  const facadePkg = assertNoWorkspaceSpecInTarball(join(outDir, facadeTgz), FACADE_PACKAGE_NAME)
  packages[FACADE_PACKAGE_NAME] = {
    tarball: facadeTgz,
    sha256: sha256File(join(outDir, facadeTgz)),
    version: facadePkg.version,
  }

  const loaderTgz = packLoader(outDir, version)
  const packedLoader = assertNoWorkspaceSpecInTarball(join(outDir, loaderTgz), LOADER_PACKAGE_NAME)
  packages[LOADER_PACKAGE_NAME] = {
    tarball: loaderTgz,
    sha256: sha256File(join(outDir, loaderTgz)),
    version: packedLoader.version,
  }

  for (const t of selected) {
    const tgz = packTarget(outDir, t)
    const packed = assertNoWorkspaceSpecInTarball(join(outDir, tgz), t.packageName)
    // Native target tarballs must contain the binary filename.
    const listing = spawnSync('tar', ['-tzf', join(outDir, tgz)], { encoding: 'utf8' })
    if (t.kind === 'node' && !listing.stdout.includes(t.binary)) {
      // Allow alternate single .node name if package main points at it.
      if (![...listing.stdout.split('\n')].some(line => line.endsWith('.node'))) {
        throw new Error(`prepare-clean-install-packages: no .node in ${tgz}`)
      }
    }
    if (t.kind === 'wasm' && !listing.stdout.includes('.wasm')) {
      throw new Error(`prepare-clean-install-packages: no .wasm in ${tgz}`)
    }
    packages[t.packageName] = {
      tarball: tgz,
      sha256: sha256File(join(outDir, tgz)),
      version: packed.version,
    }
  }

  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    loaderVersion: version,
    targets: selected.map(t => t.dir),
    packages,
  }
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(
    `prepare-clean-install-packages: OK — ${Object.keys(packages).length} packages → ${outDir}`,
  )
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
