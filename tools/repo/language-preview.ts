#!/usr/bin/env tsx
/**
 * Local rehearsal preview: build → artifact gate → publish → install-smoke.
 * Does not push git tags, so it never fires a language publish workflow.
 */

import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lookupPath, sdkPath } from '../shared/repo-paths.js'
import { joinRel, lookupRel, REPO_ROOT } from '../shared/paths.js'
import {
  coverageReportLines,
  defaultPreviewRunNumber,
  goProductionModulePath,
  hostCoverage,
  missingPreviewTokens,
  parsePreviewArgs,
  previewLanguageFamilyIds,
  previewPlan,
  previewRestoreRels,
  previewStampRels,
  pythonAllowMissingForArches,
  rubyAllowMissingForArches,
  rubyPlatformsForArches,
  selectedPythonArches,
  uncoveredHostFamilies,
  type FamilyCoverage,
  type PreviewFlags,
  type PreviewLanguage,
  type PreviewPlan,
} from './lib/language-preview.js'
import {
  readReleaseTrainVersion,
  stampPyprojectDependency,
  stampRubyVersion,
  stampTomlPackageVersion,
} from './lib/release-train.js'
import { loadSupportMatrix } from './lib/support-matrix.js'

const REHEARSAL_REGISTRY = 'http://127.0.0.1:8000'
const REHEARSAL_INDEX = `sparse+${REHEARSAL_REGISTRY}/index/`
const TESTPYPI_LEGACY = 'https://test.pypi.org/legacy/'
const TESTPYPI_SIMPLE = 'https://test.pypi.org/simple/'
const PYPI_SIMPLE = 'https://pypi.org/simple/'
const RUBY_REHEARSAL_HOST = 'https://rubygems.pkg.github.com/solvapay'
const RUBY_ABIS = '3.1:3.2:3.3:3.4'
const WINDOWS_WHEEL_TARGETS = [
  { target: 'x86_64-pc-windows-msvc', id: 'win_amd64' },
  { target: 'aarch64-pc-windows-msvc', id: 'win_arm64' },
] as const
const LINUX_DOCKER_WHEELS = [
  {
    image: 'ghcr.io/rust-cross/manylinux2014-cross:x86_64',
    compatibility: 'manylinux2014',
    platform: 'linux/amd64',
    cargoTarget: 'x86_64-unknown-linux-gnu',
    wheelId: 'manylinux-x86_64',
  },
  // rust-cross :aarch64 images are amd64 + GCC 4.8.5 and fail to compile ring
  // (__ARM_ARCH). Native arm64 manylinux images run on Apple Silicon instead.
  {
    image: 'quay.io/pypa/manylinux2014_aarch64',
    compatibility: 'manylinux2014',
    platform: 'linux/arm64',
    cargoTarget: 'aarch64-unknown-linux-gnu',
    wheelId: 'manylinux-aarch64',
  },
  {
    // pypa musllinux amd64 images are musl and fail under Docker Desktop Rosetta
    // (ld-linux-x86-64.so.2). rust-cross *-cross images are glibc hosts.
    image: 'ghcr.io/rust-cross/musllinux_1_2-cross:x86_64',
    compatibility: 'musllinux_1_1',
    platform: 'linux/amd64',
    cargoTarget: 'x86_64-unknown-linux-musl',
    wheelId: 'musllinux-x86_64',
  },
  {
    image: 'quay.io/pypa/musllinux_1_1_aarch64',
    compatibility: 'musllinux_1_1',
    platform: 'linux/arm64',
    cargoTarget: 'aarch64-unknown-linux-musl',
    wheelId: 'musllinux-aarch64',
  },
] as const
const LINUX_ZIG_WHEELS = [
  { target: 'x86_64-unknown-linux-gnu', compatibility: 'manylinux2014' },
  { target: 'aarch64-unknown-linux-gnu', compatibility: 'manylinux2014' },
  { target: 'x86_64-unknown-linux-musl', compatibility: 'musllinux_1_1' },
  { target: 'aarch64-unknown-linux-musl', compatibility: 'musllinux_1_1' },
] as const

type Cleanup = () => void

const cleanups: Cleanup[] = []

function runCleanup(): void {
  while (cleanups.length > 0) {
    const fn = cleanups.pop()
    if (fn === undefined) continue
    fn()
  }
}

function fail(step: string, result: SpawnSyncReturns<string>): never {
  const code = result.status ?? 1
  console.error(`preview failed at ${step} (exit ${code})`)
  runCleanup()
  process.exit(code)
}

function run(
  title: string,
  command: string,
  args: readonly string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): string {
  console.error(`\n=== ${title} ===`)
  const result = spawnSync(command, [...args], {
    cwd: opts?.cwd ?? REPO_ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    encoding: 'utf8',
    env: opts?.env === undefined ? process.env : { ...process.env, ...opts.env },
  })
  if (result.error !== undefined) {
    console.error(result.error)
    fail(title, result)
  }
  if (result.status !== 0) fail(title, result)
  return result.stdout ?? ''
}

function runCapture(
  title: string,
  command: string,
  args: readonly string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): string {
  console.error(`\n=== ${title} ===`)
  const result = spawnSync(command, [...args], {
    cwd: opts?.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: opts?.env === undefined ? process.env : { ...process.env, ...opts.env },
  })
  if (result.error !== undefined) {
    console.error(result.error)
    fail(title, result)
  }
  if (result.status !== 0) fail(title, result)
  return result.stdout.trim()
}

function tryRun(
  title: string,
  command: string,
  args: readonly string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): boolean {
  console.error(`\n=== ${title} ===`)
  const result = spawnSync(command, [...args], {
    cwd: opts?.cwd ?? REPO_ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
    env: opts?.env === undefined ? process.env : { ...process.env, ...opts.env },
  })
  if (result.status === 0 && result.error === undefined) return true
  console.error(`preview: ${title} failed; skipping`)
  return false
}

function commandExists(bin: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(probe, [bin], { encoding: 'utf8' })
  return result.status === 0
}

function gitPorcelain(relPaths: readonly string[]): string {
  const result = spawnSync('git', ['status', '--porcelain', '--', ...relPaths], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error('preview: git status failed while checking stamp files')
  }
  return result.stdout.trim()
}

function assertStampFilesClean(relPaths: readonly string[]): void {
  if (relPaths.length === 0) return
  const dirty = gitPorcelain(relPaths)
  if (dirty.length > 0) {
    throw new Error(`preview: refuse to stamp a dirty tree:\n${dirty}`)
  }
}

function restoreFiles(relPaths: readonly string[]): void {
  if (relPaths.length === 0) return
  const result = spawnSync('git', ['checkout', '--', ...relPaths], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error('preview: failed to restore stamped files')
  }
}

function coreSha(): string {
  return runCapture('git rev-parse HEAD', 'git', ['rev-parse', 'HEAD'])
}

function posixRel(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/')
}

function releaseEnv(version: string, sha: string): NodeJS.ProcessEnv {
  return {
    SOLVAPAY_RELEASE_VERSION: version,
    SOLVAPAY_CORE_SHA: sha,
  }
}

function emptyDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

function copyGems(fromDir: string, toDir: string): void {
  if (!existsSync(fromDir)) return
  for (const name of readdirSync(fromDir)) {
    if (!name.endsWith('.gem')) continue
    writeFileSync(path.join(toDir, name), readFileSync(path.join(fromDir, name)))
  }
}

async function waitForRegistry(): Promise<void> {
  const url = `${REHEARSAL_REGISTRY}/index/config.json`
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        console.error('rehearsal registry is up')
        return
      }
    } catch {
      // Registry has not accepted connections yet.
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error('preview: rehearsal registry did not start on 127.0.0.1:8000')
}

function startCargoRegistry(): ChildProcess {
  if (!commandExists('cargo-http-registry')) {
    throw new Error('preview: cargo-http-registry is required (cargo install cargo-http-registry)')
  }
  const registryDir = mkdtempSync(path.join(tmpdir(), 'solvapay-rehearsal-registry-'))
  const child = spawn('cargo-http-registry', [registryDir], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
  cleanups.push(() => {
    child.kill('SIGTERM')
  })
  return child
}

function stampLanguage(language: PreviewLanguage, version: string): string[] {
  const restoreRels = [...previewRestoreRels(language)]
  assertStampFilesClean(restoreRels)
  for (const rel of previewStampRels(language)) {
    const abs = joinRel(REPO_ROOT, rel)
    const original = readFileSync(abs, 'utf8')
    let next =
      language === 'ruby'
        ? stampRubyVersion(original, version)
        : stampTomlPackageVersion(original, version)
    if (rel === lookupRel('pythonMcpPyproject')) {
      next = stampPyprojectDependency(next, version)
    }
    writeFileSync(abs, next)
  }
  cleanups.push(() => restoreFiles(restoreRels))
  return restoreRels
}

function coverageById(coverage: readonly FamilyCoverage[]): Map<string, FamilyCoverage> {
  return new Map(coverage.map(row => [row.id, row]))
}

function hostCanBuild(row: FamilyCoverage | undefined, zig: boolean): boolean {
  if (row === undefined) return false
  if (row.coverage === 'unavailable') return false
  if (row.coverage === 'zig') return zig
  return true
}

async function previewRust(plan: PreviewPlan, sha: string): Promise<void> {
  const version = plan.versions.rust
  stampLanguage('rust', version)
  run('cargo build --workspace', 'cargo', ['build', '--workspace', '--exclude', 'solvapay-wasm'], {
    env: releaseEnv(version, sha),
  })
  run('check-publish-graph', lookupPath('checkPublishGraph'), [])
  if (plan.dryRun) return

  startCargoRegistry()
  await waitForRegistry()
  const cargoEnv = {
    ...releaseEnv(version, sha),
    CARGO_REGISTRIES_REHEARSAL_INDEX: REHEARSAL_INDEX,
  }
  run(
    'crates-publish rehearsal',
    lookupPath('cratesPublish'),
    ['--registry', 'rehearsal', '--version', version],
    { env: cargoEnv },
  )

  const smokeDir = mkdtempSync(path.join(tmpdir(), 'solvapay-rust-smoke-'))
  run('cargo new smoke', 'cargo', ['new', '--bin', path.join(smokeDir, 'smoke')])
  run('cargo add solvapay', 'cargo', ['add', `solvapay@${version}`, '--registry', 'rehearsal'], {
    cwd: path.join(smokeDir, 'smoke'),
    env: cargoEnv,
  })
  run('cargo build smoke', 'cargo', ['build'], {
    cwd: path.join(smokeDir, 'smoke'),
    env: cargoEnv,
  })
}

function pythonDockerWorkdir(): string {
  return `/io/${posixRel(sdkPath('python'))}`
}

function previewHostCache(name: string): string {
  const dir = path.join(tmpdir(), `solvapay-preview-${name}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function buildPythonLinuxDocker(
  version: string,
  sha: string,
  coverage: Map<string, FamilyCoverage>,
  zig: boolean,
): string[] {
  const workdir = pythonDockerWorkdir()
  const skipped: string[] = []
  for (const cell of LINUX_DOCKER_WHEELS) {
    const row = coverage.get(cell.wheelId)
    if (!hostCanBuild(row, zig)) {
      console.error(`preview: skip ${cell.wheelId} — ${row?.reason ?? 'not covered on this host'}`)
      skipped.push(cell.wheelId)
      continue
    }
    if (row?.coverage === 'zig') {
      skipped.push(cell.wheelId)
      continue
    }
    const cacheKey = `${cell.platform.replace('/', '-')}-${cell.compatibility}`
    const cargoHome = previewHostCache(`${cacheKey}-cargo`)
    const rustupHome = previewHostCache(`${cacheKey}-rustup`)
    const script = [
      'set -euo pipefail',
      'for bin in /opt/python/cp312-cp312/bin /opt/python/cp310-cp310/bin; do',
      '  if [ -d "$bin" ]; then export PATH="$bin:$PATH"; break; fi',
      'done',
      'export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"',
      'if ! command -v cargo >/dev/null 2>&1; then',
      "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none",
      'fi',
      '. "$HOME/.cargo/env"',
      '(cd /io && rustup show)',
      `rustup target add ${cell.cargoTarget}`,
      'python3 -m pip install --user -q maturin',
      `maturin build --release --out dist --target ${cell.cargoTarget} --compatibility ${cell.compatibility}`,
    ].join('\n')
    run(`docker ${cell.image}`, 'docker', [
      'run',
      '--rm',
      '--platform',
      cell.platform,
      '-v',
      `${REPO_ROOT}:/io`,
      '-v',
      `${cargoHome}:/root/.cargo`,
      '-v',
      `${rustupHome}:/root/.rustup`,
      '-w',
      workdir,
      '-e',
      `SOLVAPAY_RELEASE_VERSION=${version}`,
      '-e',
      `SOLVAPAY_CORE_SHA=${sha}`,
      cell.image,
      'bash',
      '-lc',
      script,
    ])
  }
  return skipped
}

function buildPythonLinuxZig(version: string, sha: string): void {
  const pythonCwd = sdkPath('python')
  const triples = LINUX_ZIG_WHEELS.map(cell => cell.target)
  run('rustup linux zig targets', 'rustup', ['target', 'add', ...triples])
  for (const cell of LINUX_ZIG_WHEELS) {
    run(
      `maturin zig ${cell.target}`,
      'uv',
      [
        'run',
        '--extra',
        'dev',
        'maturin',
        'build',
        '--release',
        '--zig',
        '--target',
        cell.target,
        '--compatibility',
        cell.compatibility,
        '--out',
        'dist',
      ],
      { cwd: pythonCwd, env: releaseEnv(version, sha) },
    )
  }
}

function skippedWindowsWheels(
  version: string,
  sha: string,
  coverage: Map<string, FamilyCoverage>,
): string[] {
  const pythonCwd = sdkPath('python')
  const skipped: string[] = []
  for (const cell of WINDOWS_WHEEL_TARGETS) {
    const row = coverage.get(cell.id)
    if (row?.coverage === 'unavailable') {
      console.error(`preview: skip ${cell.id} — ${row.reason}`)
      skipped.push(cell.id)
      continue
    }
    const ok = tryRun(
      `maturin windows ${cell.target}`,
      'uv',
      [
        'run',
        '--extra',
        'dev',
        'maturin',
        'build',
        '--release',
        '--out',
        'dist',
        '--target',
        cell.target,
      ],
      { cwd: pythonCwd, env: releaseEnv(version, sha) },
    )
    if (!ok) skipped.push(cell.id)
  }
  return skipped
}

async function previewPython(
  plan: PreviewPlan,
  flags: PreviewFlags,
  sha: string,
  coverage: Map<string, FamilyCoverage>,
  built: Set<string>,
): Promise<void> {
  const version = plan.versions.python
  const pythonCwd = sdkPath('python')
  const pythonMcpCwd = sdkPath('pythonMcp')
  stampLanguage('python', version)
  emptyDir(path.join(pythonCwd, 'dist'))
  emptyDir(path.join(pythonMcpCwd, 'dist'))

  const arches = selectedPythonArches(flags)
  const skippedArch = pythonAllowMissingForArches(flags.arch)
  let skippedLinux: string[] = []
  let skippedWindows: string[] = []

  if (arches.includes('macos')) {
    run('rustup macos targets', 'rustup', [
      'target',
      'add',
      'x86_64-apple-darwin',
      'aarch64-apple-darwin',
    ])
  }
  if (arches.includes('linux')) {
    if (flags.zig) {
      buildPythonLinuxZig(version, sha)
      for (const cell of LINUX_ZIG_WHEELS) {
        if (cell.compatibility.startsWith('musl')) {
          built.add(cell.target.includes('aarch64') ? 'musllinux-aarch64' : 'musllinux-x86_64')
        } else {
          built.add(cell.target.includes('aarch64') ? 'manylinux-aarch64' : 'manylinux-x86_64')
        }
      }
    } else {
      skippedLinux = buildPythonLinuxDocker(version, sha, coverage, flags.zig)
      for (const cell of LINUX_DOCKER_WHEELS) {
        if (!skippedLinux.includes(cell.wheelId)) built.add(cell.wheelId)
      }
    }
  }
  if (arches.includes('macos')) {
    run(
      'maturin universal2',
      'uv',
      [
        'run',
        '--extra',
        'dev',
        'maturin',
        'build',
        '--release',
        '--out',
        'dist',
        '--target',
        'universal2-apple-darwin',
      ],
      { cwd: pythonCwd, env: releaseEnv(version, sha) },
    )
    built.add('macos-universal2')
  }
  if (arches.includes('windows')) {
    skippedWindows = skippedWindowsWheels(version, sha, coverage)
    for (const cell of WINDOWS_WHEEL_TARGETS) {
      if (!skippedWindows.includes(cell.id)) built.add(cell.id)
    }
  }
  run('maturin sdist', 'uv', ['run', '--extra', 'dev', 'maturin', 'sdist', '--out', 'dist'], {
    cwd: pythonCwd,
    env: releaseEnv(version, sha),
  })
  run(
    'python-mcp sdist',
    'uv',
    ['run', '--with', 'build', 'python', '-m', 'build', '--sdist', '--outdir', 'dist'],
    {
      cwd: pythonMcpCwd,
    },
  )

  const allowMissing = [
    ...new Set([...flags.allowMissing, ...skippedArch, ...skippedLinux, ...skippedWindows]),
  ]
  const checkArgs = ['--dir', path.join(pythonCwd, 'dist')]
  if (allowMissing.length > 0) {
    checkArgs.push('--allow-missing', allowMissing.join(','))
  }
  run('check-wheels', 'python3', [lookupPath('pythonCheckWheels'), ...checkArgs])
  if (plan.dryRun) return

  const token = process.env.SOLVAPAY_TESTPYPI_TOKEN
  if (token === undefined || token.length === 0) {
    throw new Error('preview: SOLVAPAY_TESTPYPI_TOKEN is required to publish Python')
  }
  run(
    'uv publish solvapay',
    'uv',
    ['publish', '--publish-url', TESTPYPI_LEGACY, '--token', token],
    { cwd: pythonCwd },
  )
  run(
    'uv publish solvapay-mcp',
    'uv',
    ['publish', '--publish-url', TESTPYPI_LEGACY, '--token', token],
    { cwd: pythonMcpCwd },
  )
  run('python install-smoke', 'python3', [
    lookupPath('pythonInstallSmoke'),
    '--index-url',
    TESTPYPI_SIMPLE,
    '--extra-index-url',
    PYPI_SIMPLE,
    '--package',
    'solvapay',
    '--version',
    version,
  ])
}

async function previewRuby(
  plan: PreviewPlan,
  sha: string,
  coverage: Map<string, FamilyCoverage>,
  built: Set<string>,
): Promise<void> {
  const version = plan.versions.ruby
  const rubyCwd = sdkPath('ruby')
  const rubyMcpCwd = sdkPath('rubyMcp')
  stampLanguage('ruby', version)
  const gemsDir = path.join(rubyCwd, 'gems')
  emptyDir(gemsDir)
  emptyDir(path.join(rubyCwd, 'pkg'))
  emptyDir(path.join(rubyMcpCwd, 'pkg'))

  run('bundle install', 'bundle', ['install'], { cwd: rubyCwd })
  const platforms = rubyPlatformsForArches(plan.arch)
  const skippedPlatforms: string[] = []
  let usedHostNative = false
  for (const platform of platforms) {
    const row = coverage.get(platform)
    if (row?.coverage === 'native') {
      run(`rake native gem (${platform})`, 'bundle', ['exec', 'rake', 'native', 'gem'], {
        cwd: rubyCwd,
        env: releaseEnv(version, sha),
      })
      usedHostNative = true
      built.add(platform)
      continue
    }
    if (row?.coverage === 'docker') {
      run(`dock-build ${platform}`, lookupPath('rubyDockBuild'), [platform, RUBY_ABIS], {
        env: releaseEnv(version, sha),
      })
      built.add(platform)
      continue
    }
    console.error(`preview: skip ${platform} — ${row?.reason ?? 'not covered on this host'}`)
    skippedPlatforms.push(platform)
  }
  run('rake build', 'bundle', ['exec', 'rake', 'build'], {
    cwd: rubyCwd,
    env: releaseEnv(version, sha),
  })
  run(
    'gem build solvapay-mcp',
    'gem',
    ['build', 'solvapay-mcp.gemspec', '--output', 'pkg/solvapay-mcp.gem'],
    {
      cwd: rubyMcpCwd,
    },
  )
  copyGems(path.join(rubyCwd, 'pkg'), gemsDir)
  copyGems(path.join(rubyMcpCwd, 'pkg'), gemsDir)
  const checkGemsArgs = [lookupPath('rubyCheckGems'), '--dir', gemsDir]
  if (usedHostNative) checkGemsArgs.push('--host-native')
  const allowMissingGems = [
    ...new Set([...rubyAllowMissingForArches(plan.arch), ...skippedPlatforms]),
  ]
  if (allowMissingGems.length > 0) {
    checkGemsArgs.push('--allow-missing', allowMissingGems.join(','))
  }
  run('check-gems', 'ruby', checkGemsArgs)
  if (plan.dryRun) return

  const token = process.env.GEM_HOST_API_KEY
  if (token === undefined || token.length === 0) {
    throw new Error('preview: GEM_HOST_API_KEY is required to publish Ruby')
  }
  for (const name of readdirSync(gemsDir)) {
    if (!name.endsWith('.gem')) continue
    run(
      `gem push ${name}`,
      'gem',
      ['push', '--host', RUBY_REHEARSAL_HOST, path.join(gemsDir, name)],
      { env: { GEM_HOST_API_KEY: token } },
    )
  }
  run('ruby install-smoke', 'ruby', [
    lookupPath('rubyInstallSmoke'),
    '--host',
    RUBY_REHEARSAL_HOST,
    '--name',
    'solvapay',
    '--version',
    version,
  ])
}

async function previewGo(_plan: PreviewPlan): Promise<void> {
  const goCwd = sdkPath('go')
  const wasmPath = path.join(goCwd, 'solvapay_core.wasm')
  run('rustup wasm32-wasip1', 'rustup', ['target', 'add', 'wasm32-wasip1'])
  run('build-wasm', lookupPath('goWasmBuild'), [])
  const stale = spawnSync('git', ['diff', '--exit-code', '--', wasmPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  if (stale.status !== 0) {
    console.error(
      'preview: embedded wasm differs from HEAD (host rebuild is not bit-stable); restoring committed blob',
    )
    restoreFiles([posixRel(wasmPath)])
  }
  run('go build', 'go', ['build', './...'], { cwd: goCwd })
  run('go vet', 'go', ['vet', './...'], { cwd: goCwd })

  const modulePath = goProductionModulePath()
  const smoke = mkdtempSync(path.join(tmpdir(), 'solvapay-go-smoke-'))
  writeFileSync(
    path.join(smoke, 'go.mod'),
    [
      'module github.com/solvapay/solvapay-go-smoke',
      '',
      'go 1.25',
      '',
      `require ${modulePath} v0.0.0`,
      '',
      `replace ${modulePath} => ${goCwd}`,
      '',
    ].join('\n'),
  )
  writeFileSync(
    path.join(smoke, 'main.go'),
    [
      'package main',
      '',
      'import (',
      '\t"context"',
      '\t"fmt"',
      '',
      `\tsolvapay "${modulePath}"`,
      ')',
      '',
      'func main() {',
      '\tctx := context.Background()',
      '\tv, err := solvapay.Version(ctx)',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tfmt.Println(v)',
      '}',
      '',
    ].join('\n'),
  )
  run('go mod tidy', 'go', ['mod', 'tidy'], { cwd: smoke })
  run('go build smoke', 'go', ['build', '-o', path.join(smoke, 'solvapay-go-smoke'), '.'], {
    cwd: smoke,
  })
}

async function runLanguage(
  language: PreviewLanguage,
  plan: PreviewPlan,
  flags: PreviewFlags,
  sha: string,
  coverage: Map<string, FamilyCoverage>,
  built: Set<string>,
): Promise<void> {
  console.error(`\n######## preview ${language} ${plan.versions[language]} ########`)
  switch (language) {
    case 'rust':
      await previewRust(plan, sha)
      return
    case 'python':
      await previewPython(plan, flags, sha, coverage, built)
      return
    case 'ruby':
      await previewRuby(plan, sha, coverage, built)
      return
    case 'go':
      await previewGo(plan)
      return
  }
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const flags = parsePreviewArgs(argv)
  const baseVersion = flags.version ?? readReleaseTrainVersion(REPO_ROOT)
  const plan = previewPlan(
    { ...flags, run: flags.run ?? defaultPreviewRunNumber(), version: baseVersion },
    baseVersion,
  )
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  }

  if (!plan.dryRun) {
    const missing = missingPreviewTokens(plan.languages, process.env)
    if (missing.length > 0) {
      throw new Error(`preview: missing required tokens: ${missing.join(', ')}`)
    }
  }

  const sha = coreSha()
  const matrix = loadSupportMatrix(REPO_ROOT)
  const coverage = coverageById(
    hostCoverage(matrix, { platform: process.platform, arch: process.arch }),
  )
  const built = new Set<string>()
  process.on('SIGINT', () => {
    runCleanup()
    process.exit(130)
  })
  process.on('SIGTERM', () => {
    runCleanup()
    process.exit(143)
  })

  try {
    for (const language of plan.languages) {
      await runLanguage(language, plan, flags, sha, coverage, built)
    }
    const rows = [...coverage.values()]
    const relevant = previewLanguageFamilyIds(matrix, plan.languages)
    for (const line of coverageReportLines(rows, relevant, built)) {
      console.error(line)
    }
    const uncovered = uncoveredHostFamilies(rows, relevant, built)
    if (uncovered.length > 0 && !flags.acceptPartial) {
      throw new Error(
        'preview: incomplete host coverage; pass --accept-partial to accept a partial run',
      )
    }
    console.error('\npreview complete')
  } finally {
    runCleanup()
  }
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  void main().catch(error => {
    runCleanup()
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
