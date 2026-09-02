/**
 * Ops-by-facade coverage matrix (ICU4X missing_apis.txt generalised).
 *
 * Reads binding-symbols.snapshot.json and scans the 11 `sdks/` facades for
 * each op's language name. Gaps require a reason. `pnpm gen` writes the
 * committed matrix; drift is a red build.
 *
 *   pnpm facade-coverage
 *   pnpm facade-coverage --check
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../shared/paths.js'
import { generatedEntry, sdkPath } from '../shared/repo-paths.js'
import { isDirectRun, parseErrorResult, runScriptMain, type CliResult } from './lib/cli.js'

export const FACADE_COVERAGE_PATH = generatedEntry('facadeCoverage').path
const BINDING_SYMBOLS_PATH = generatedEntry('bindingSymbols').path

function absRel(rel: string): string {
  return path.join(REPO_ROOT, ...rel.split('/'))
}

export const FACADES = [
  'capi',
  'go',
  'node-native',
  'python',
  'python-mcp',
  'ruby',
  'ruby-mcp',
  'rust',
  'rust-mcp',
  'typescript',
  'wasm',
] as const

export type FacadeId = (typeof FACADES)[number]
type NameKey = 'ts' | 'py' | 'rb' | 'go' | 'rust' | 'c'

const FACADE_SCAN: Record<FacadeId, { nameKey: NameKey; roots: string[] }> = {
  capi: {
    nameKey: 'c',
    roots: [
      path.join(sdkPath('capi'), 'src', 'dispatch.rs'),
      path.join(sdkPath('capi'), 'src', 'lib.rs'),
    ],
  },
  go: {
    nameKey: 'go',
    roots: [
      path.join(sdkPath('go'), 'client_generated.go'),
      path.join(sdkPath('go'), 'helpers_generated.go'),
      path.join(sdkPath('go'), 'internal', 'dispatch'),
      path.join(sdkPath('go'), 'internal', 'contract'),
      path.join(sdkPath('go'), 'wasm', 'src'),
    ],
  },
  'node-native': { nameKey: 'ts', roots: [path.join(sdkPath('node-native'), 'src')] },
  python: {
    nameKey: 'py',
    roots: [
      path.join(sdkPath('python'), 'src'),
      path.join(sdkPath('python'), 'python', 'solvapay'),
    ],
  },
  'python-mcp': { nameKey: 'py', roots: [path.join(sdkPath('pythonMcp'), 'python')] },
  ruby: {
    nameKey: 'rb',
    roots: [
      path.join(sdkPath('ruby'), 'ext', 'solvapay', 'src'),
      path.join(sdkPath('ruby'), 'lib'),
    ],
  },
  'ruby-mcp': { nameKey: 'rb', roots: [path.join(sdkPath('rubyMcp'), 'lib')] },
  rust: { nameKey: 'rust', roots: [path.join(sdkPath('rust'), 'src')] },
  'rust-mcp': { nameKey: 'rust', roots: [path.join(sdkPath('rustMcp'), 'src')] },
  typescript: { nameKey: 'ts', roots: [sdkPath('typescript')] },
  wasm: { nameKey: 'ts', roots: [path.join(sdkPath('wasm'), 'src')] },
}

const MCP_ONLY_REASON =
  'mcp-only facade; this op is exposed on the language SDK, not the MCP package'

const CAPI_SYNC_GAP =
  'C ABI client dispatch (`solvapay_client_call`) covers HTTP ops; this helper is not in the C table'

const RUST_FACADE_GAP =
  'not re-exported from the `solvapay` rust facade crate; call `solvapay-core` or another language SDK'

const GO_FACADE_GAP =
  'not on the Go public facade; the WASI guest or contract harness may still bind it internally'

export type FacadeCell = { exposed: true } | { exposed: false; reason: string }

export type FacadeCoverageFile = {
  _comment: string
  facades: readonly FacadeId[]
  ops: Record<string, Record<FacadeId, FacadeCell>>
}

type BindingNames = Partial<Record<NameKey, string>>

type BindingSnapshot = {
  bindings: Record<
    string,
    {
      names: BindingNames
      catalog?: { kind?: string; id?: string }
      artifact?: string
      section?: string
      rustFnName?: string
    }
  >
}

function collectFiles(abs: string, acc: string[]): void {
  if (!existsSync(abs)) {
    return
  }
  const st = statSync(abs)
  if (st.isDirectory()) {
    for (const name of readdirSync(abs)) {
      if (
        name === 'target' ||
        name === 'node_modules' ||
        name === '.bundle' ||
        name === 'tests' ||
        name === 'test' ||
        name === '__tests__' ||
        name === '__test__'
      ) {
        continue
      }
      collectFiles(path.join(abs, name), acc)
    }
    return
  }
  if (/\.(rs|go|py|rb|ts|tsx|c|h)$/.test(abs)) {
    acc.push(abs)
  }
}

function loadCorpus(facade: FacadeId): string {
  const files: string[] = []
  for (const root of FACADE_SCAN[facade].roots) {
    collectFiles(root, files)
  }
  return files.map(file => readFileSync(file, 'utf8')).join('\n')
}

function nameExposed(corpus: string, name: string | undefined): boolean {
  if (!name) {
    return false
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`).test(corpus)
}

function isMcpFacade(facade: FacadeId): boolean {
  return facade.endsWith('-mcp')
}

export function buildFacadeCoverage(
  snapshot: BindingSnapshot,
  previous: FacadeCoverageFile | null,
): FacadeCoverageFile {
  const corpora = Object.fromEntries(FACADES.map(id => [id, loadCorpus(id)])) as Record<
    FacadeId,
    string
  >
  const ops: FacadeCoverageFile['ops'] = {}
  for (const [opId, entry] of Object.entries(snapshot.bindings).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const row = {} as Record<FacadeId, FacadeCell>
    for (const facade of FACADES) {
      const candidates = [opId, entry.rustFnName, ...Object.values(entry.names)].filter(
        (name): name is string => typeof name === 'string' && name.length > 0,
      )
      const exposed = candidates.some(name => nameExposed(corpora[facade], name))
      if (exposed) {
        row[facade] = { exposed: true }
        continue
      }
      const prior = previous?.ops[opId]?.[facade]
      if (prior && prior.exposed === false && prior.reason.trim() !== '') {
        row[facade] = prior
        continue
      }
      if (isMcpFacade(facade)) {
        row[facade] = { exposed: false, reason: MCP_ONLY_REASON }
        continue
      }
      if (facade === 'capi') {
        row[facade] = { exposed: false, reason: CAPI_SYNC_GAP }
        continue
      }
      if (facade === 'rust') {
        row[facade] = { exposed: false, reason: RUST_FACADE_GAP }
        continue
      }
      if (facade === 'go') {
        row[facade] = { exposed: false, reason: GO_FACADE_GAP }
        continue
      }
      row[facade] = {
        exposed: false,
        reason: `not found under ${FACADE_SCAN[facade].roots
          .map(root => path.relative(REPO_ROOT, root))
          .join(', ')}`,
      }
    }
    ops[opId] = row
  }
  return {
    _comment:
      '@generated by facade-coverage — do not edit exposed flags; fill reason on new gaps. Regenerate: pnpm gen',
    facades: FACADES,
    ops,
  }
}

export function missingReasons(coverage: FacadeCoverageFile): string[] {
  const missing: string[] = []
  for (const [opId, row] of Object.entries(coverage.ops)) {
    for (const facade of FACADES) {
      const cell = row[facade]
      if (cell.exposed === false && cell.reason.trim() === '') {
        missing.push(`${opId}.${facade}`)
      }
    }
  }
  return missing
}

function readPrevious(): FacadeCoverageFile | null {
  const abs = absRel(FACADE_COVERAGE_PATH)
  if (!existsSync(abs)) {
    return null
  }
  return JSON.parse(readFileSync(abs, 'utf8')) as FacadeCoverageFile
}

function readSnapshot(): BindingSnapshot {
  const abs = absRel(BINDING_SYMBOLS_PATH)
  return JSON.parse(readFileSync(abs, 'utf8')) as BindingSnapshot
}

export function writeFacadeCoverage(): { coverage: FacadeCoverageFile; text: string } {
  const coverage = buildFacadeCoverage(readSnapshot(), readPrevious())
  const text = `${JSON.stringify(coverage, null, 2)}\n`
  writeFileSync(absRel(FACADE_COVERAGE_PATH), text)
  return { coverage, text }
}

export interface CliOptions {
  check: boolean
}

function printUsage(): string {
  return `Usage:
  pnpm facade-coverage
  pnpm facade-coverage --check
`
}

export function parseArgs(argv: string[]): CliOptions {
  let check = false
  for (const arg of argv) {
    if (arg === '--check') {
      check = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      throw new Error(printUsage().trim())
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return { check }
}

export function runFacadeCoverage(options: CliOptions): CliResult {
  const previousText = existsSync(absRel(FACADE_COVERAGE_PATH))
    ? readFileSync(absRel(FACADE_COVERAGE_PATH), 'utf8')
    : ''
  const { coverage, text } = writeFacadeCoverage()
  const gaps = missingReasons(coverage)
  if (gaps.length > 0) {
    return {
      exitCode: 1,
      stdout: '',
      stderr:
        'facade-coverage: gaps without a reason:\n' +
        gaps.map(gap => `  - ${gap}`).join('\n') +
        '\n',
    }
  }
  if (options.check && previousText !== text) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `facade-coverage: ${FACADE_COVERAGE_PATH} is stale — run pnpm gen\n`,
    }
  }
  return {
    exitCode: 0,
    stdout: `facade-coverage: ${Object.keys(coverage.ops).length} ops × ${FACADES.length} facades\n`,
    stderr: '',
  }
}

export async function runCli(argv: string[]): Promise<CliResult> {
  try {
    return runFacadeCoverage(parseArgs(argv))
  } catch (error) {
    return parseErrorResult(error, printUsage())
  }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(runCli)
}
