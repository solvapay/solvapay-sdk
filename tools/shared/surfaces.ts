/**
 * Registry of build/test surfaces. Paths resolve through repo-paths.yaml.
 */

import { contractInputPath, lookupPath, sdkPath } from './repo-paths.js'
import { REPO_ROOT } from './paths.js'
import type { BinRequirement, Task } from './task-runner.js'

export type SurfaceTier = 'core' | 'native'

export interface Surface {
  id: string
  label: string
  tier: SurfaceTier
  cwd: string
  requires?: readonly BinRequirement[]
  testsRequireBuild?: boolean
  build: Task[]
  test: Task[]
  prepare?: Task[]
}

function req(bin: string, install: string): BinRequirement {
  return { bin, install }
}

function task(
  id: string,
  label: string,
  command: string,
  args: readonly string[],
  cwd: string,
  requires?: readonly BinRequirement[],
): Task {
  return { id, label, command, args, cwd, requires }
}

const rustCwd = REPO_ROOT
const tsCwd = REPO_ROOT
const goCwd = sdkPath('go')
const capiCwd = sdkPath('capi')
const nodeNativeCwd = sdkPath('node-native')
const wasmCwd = sdkPath('wasm')
const pythonCwd = sdkPath('python')
const rubyCwd = sdkPath('ruby')
const fixturesDir = contractInputPath('fixtures')
const goWasmBuild = lookupPath('goWasmBuild')
const capiRun = lookupPath('capiCtestRun')
const capiContract = lookupPath('capiCtestContract')

const rustRequires = [req('cargo', 'https://rustup.rs')]
const goRequires = [req('go', 'https://go.dev/dl')]
const nodeNativeRequires = [req('napi', 'pnpm add -Dw @napi-rs/cli')]
const wasmRequires = [
  req('wasm-bindgen', 'cargo install wasm-bindgen-cli'),
  req('wasm-opt', 'npm install -g binaryen'),
]
const pythonRequires = [req('maturin', 'pip install maturin')]
const rubyRequires = [req('bundle', 'gem install bundler')]
const goGuestRequires = [req('cargo', 'rustup target add wasm32-wasip1')]

export const SURFACES: readonly Surface[] = [
  {
    id: 'rust',
    label: 'Rust workspace',
    tier: 'core',
    cwd: rustCwd,
    requires: rustRequires,
    build: [
      task(
        'rust.workspace.build',
        'Rust workspace',
        'cargo',
        ['build', '--workspace', '--exclude', 'solvapay-wasm'],
        rustCwd,
        rustRequires,
      ),
      task(
        'rust.blocking.build',
        'Rust blocking facade',
        'cargo',
        ['build', '-p', 'solvapay', '--features', 'blocking'],
        rustCwd,
        rustRequires,
      ),
    ],
    test: [
      task(
        'rust.workspace.test',
        'Rust workspace',
        'cargo',
        ['test', '--workspace', '--exclude', 'solvapay-wasm'],
        rustCwd,
        rustRequires,
      ),
      task(
        'rust.blocking.test',
        'Rust blocking facade',
        'cargo',
        ['test', '-p', 'solvapay', '--features', 'blocking'],
        rustCwd,
        rustRequires,
      ),
    ],
  },
  {
    id: 'typescript',
    label: 'TypeScript packages',
    tier: 'core',
    cwd: tsCwd,
    build: [
      task('typescript.packages.build', 'TypeScript packages', 'pnpm', ['build:packages'], tsCwd),
    ],
    test: [task('typescript.packages.test', 'TypeScript packages', 'pnpm', ['test'], tsCwd)],
  },
  {
    id: 'go',
    label: 'Go',
    tier: 'core',
    cwd: goCwd,
    requires: goRequires,
    build: [task('go.build', 'Go', 'go', ['build', './...'], goCwd, goRequires)],
    test: [task('go.test', 'Go', 'go', ['test', '-race', './...'], goCwd, goRequires)],
  },
  {
    id: 'capi',
    label: 'C API',
    tier: 'core',
    cwd: capiCwd,
    requires: rustRequires,
    build: [
      task('capi.build', 'C API', 'cargo', ['build', '-p', 'solvapay-c'], rustCwd, rustRequires),
    ],
    test: [
      task(
        'capi.cargo.test',
        'C API cargo tests',
        'cargo',
        ['test', '-p', 'solvapay-c', '--features', 'fixture-host', '--', '--test-threads=1'],
        rustCwd,
        rustRequires,
      ),
      task('capi.ctest.run', 'C API smoke', capiRun, [], capiCwd, rustRequires),
      task('capi.ctest.contract', 'C API contract', capiContract, [], capiCwd, rustRequires),
    ],
  },
  {
    id: 'contract',
    label: 'Contract',
    tier: 'core',
    cwd: rustCwd,
    build: [],
    test: [
      task('contract.vitest', 'Contract vitest', 'pnpm', ['test:contract'], rustCwd),
      task(
        'contract.fixtures',
        'Fixture runner',
        'cargo',
        ['run', '-q', '-p', 'fixture-runner', '--', fixturesDir],
        rustCwd,
        rustRequires,
      ),
    ],
  },
  {
    id: 'node-native',
    label: 'Node native',
    tier: 'native',
    cwd: nodeNativeCwd,
    requires: nodeNativeRequires,
    testsRequireBuild: true,
    build: [
      task(
        'node-native.build',
        'Node native',
        'napi',
        ['build', '--platform', '--release'],
        nodeNativeCwd,
        nodeNativeRequires,
      ),
    ],
    prepare: [
      task(
        'node-native.prepare',
        'Node native prepare',
        'napi',
        ['build', '--platform', '--release'],
        nodeNativeCwd,
        nodeNativeRequires,
      ),
    ],
    test: [
      task(
        'node-native.test',
        'Node native',
        'node',
        ['--test', '__test__/binding.spec.mjs'],
        nodeNativeCwd,
        nodeNativeRequires,
      ),
    ],
  },
  {
    id: 'wasm',
    label: 'WASM',
    tier: 'native',
    cwd: wasmCwd,
    requires: wasmRequires,
    testsRequireBuild: true,
    build: [task('wasm.build', 'WASM', 'pnpm', ['build:wasm'], wasmCwd, wasmRequires)],
    prepare: [task('wasm.prepare', 'WASM prepare', 'pnpm', ['build:wasm'], wasmCwd, wasmRequires)],
    test: [task('wasm.test', 'WASM', 'pnpm', ['test'], wasmCwd, wasmRequires)],
  },
  {
    id: 'python',
    label: 'Python',
    tier: 'native',
    cwd: pythonCwd,
    requires: pythonRequires,
    testsRequireBuild: true,
    build: [
      task(
        'python.build',
        'Python',
        'maturin',
        ['build', '--release', '--out', 'dist'],
        pythonCwd,
        pythonRequires,
      ),
    ],
    prepare: [
      task(
        'python.prepare',
        'Python prepare',
        'maturin',
        ['develop', '--release'],
        pythonCwd,
        pythonRequires,
      ),
    ],
    test: [task('python.test', 'Python', 'pytest', ['-q'], pythonCwd, pythonRequires)],
  },
  {
    id: 'ruby',
    label: 'Ruby',
    tier: 'native',
    cwd: rubyCwd,
    requires: rubyRequires,
    testsRequireBuild: true,
    build: [
      task('ruby.build', 'Ruby', 'bundle', ['exec', 'rake', 'compile'], rubyCwd, rubyRequires),
    ],
    prepare: [
      task(
        'ruby.prepare',
        'Ruby prepare',
        'bundle',
        ['exec', 'rake', 'compile'],
        rubyCwd,
        rubyRequires,
      ),
    ],
    test: [task('ruby.test', 'Ruby', 'bundle', ['exec', 'rake', 'test'], rubyCwd, rubyRequires)],
  },
  {
    id: 'go-guest',
    label: 'Go WASI guest',
    tier: 'native',
    cwd: goCwd,
    requires: goGuestRequires,
    build: [task('go-guest.build', 'Go WASI guest', goWasmBuild, [], goCwd, goGuestRequires)],
    test: [],
  },
]

export function coreSurfaces(): Surface[] {
  return SURFACES.filter(surface => surface.tier === 'core')
}

export function nativeSurfaces(): Surface[] {
  return SURFACES.filter(surface => surface.tier === 'native')
}

/** Native-tier tasks that make each binding importable/runnable in place. */
export function nativePrepareTasks(): Task[] {
  return nativeSurfaces().flatMap(surface =>
    surface.prepare !== undefined ? [...surface.prepare] : [...surface.build],
  )
}

export interface SelectFlags {
  native: boolean
  nativeOnly: boolean
  only?: string
  json: boolean
  bail: boolean
}

export function parseSelectFlags(argv: string[]): SelectFlags {
  let native = false
  let nativeOnly = false
  let only: string | undefined
  let json = false
  let bail = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--native') {
      native = true
      continue
    }
    if (arg === '--native-only') {
      nativeOnly = true
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--bail') {
      bail = true
      continue
    }
    if (arg === '--only') {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error('--only requires a surface name')
      }
      only = next
      i += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return { native, nativeOnly, only, json, bail }
}

export function selectedSurfaces(
  flags: SelectFlags,
  kind: 'build' | 'test',
): Surface[] | { error: string } {
  let pool = SURFACES.filter(surface =>
    kind === 'build' ? surface.build.length > 0 : surface.test.length > 0,
  )
  if (flags.nativeOnly) {
    pool = pool.filter(surface => surface.tier === 'native')
  } else if (!flags.native) {
    pool = pool.filter(surface => surface.tier === 'core')
  }
  if (flags.only !== undefined) {
    const names = SURFACES.map(surface => surface.id)
    if (!names.includes(flags.only)) {
      return { error: `unknown surface '${flags.only}'. Valid names: ${names.join(', ')}` }
    }
    pool = pool.filter(surface => surface.id === flags.only)
    if (pool.length === 0) {
      return {
        error: `surface '${flags.only}' is not in the selected tier. Valid names: ${names.join(', ')}`,
      }
    }
  }
  return [...pool]
}

export function selectBuildTasks(argv: string[]): Task[] | { error: string } {
  let flags: SelectFlags
  try {
    flags = parseSelectFlags(argv)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  const selected = selectedSurfaces(flags, 'build')
  if ('error' in selected) {
    return selected
  }
  return selected.flatMap(surface => [...surface.build])
}

export function selectTestTasks(argv: string[]): Task[] | { error: string } {
  let flags: SelectFlags
  try {
    flags = parseSelectFlags(argv)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  const selected = selectedSurfaces(flags, 'test')
  if ('error' in selected) {
    return selected
  }
  const tasks: Task[] = []
  for (const surface of selected) {
    if (surface.testsRequireBuild === true) {
      tasks.push(...(surface.prepare ?? []))
    }
    tasks.push(...surface.test)
  }
  return tasks
}
