/**
 * Ops-by-facade coverage matrix (ICU4X missing_apis.txt generalised).
 *
 * Reads binding-symbols.snapshot.json and scans each facade for declarations
 * of the op's language name. A gap with an empty reason fails the build.
 * MCP packages are scored only on MCP-section bindings; other ops are `na`.
 * `pnpm gen` writes the
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
  'go-mcp',
  'node-native',
  'python',
  'python-mcp',
  'ruby',
  'ruby-mcp',
  'rust',
  'rust-mcp',
  'typescript',
  'typescript-mcp',
  'wasm-edge',
  'wasm-browser',
] as const

export type FacadeId = (typeof FACADES)[number]
type NameKey = 'ts' | 'py' | 'rb' | 'go' | 'rust' | 'c'
type ScanMode = 'declarations' | 'dts-exports'

const FACADE_SCAN: Record<
  FacadeId,
  { nameKey: NameKey; roots: string[]; mode?: ScanMode; skipDir?: readonly string[] }
> = {
  capi: {
    nameKey: 'c',
    roots: [
      path.join(sdkPath('capi'), 'src', 'dispatch.rs'),
      path.join(sdkPath('capi'), 'src', 'sync_dispatch.rs'),
      path.join(sdkPath('capi'), 'src', 'lib.rs'),
    ],
  },
  go: {
    nameKey: 'go',
    roots: [sdkPath('go')],
    skipDir: [['internal', 'contract'].join('/'), 'wasm', 'mcp'],
  },
  'go-mcp': { nameKey: 'go', roots: [path.join(sdkPath('go'), 'mcp')] },
  'node-native': {
    nameKey: 'ts',
    mode: 'dts-exports',
    roots: [path.join(sdkPath('node-native'), 'index.d.ts')],
  },
  python: {
    nameKey: 'py',
    roots: [path.join(sdkPath('python'), 'python', 'solvapay')],
  },
  'python-mcp': { nameKey: 'py', roots: [path.join(sdkPath('pythonMcp'), 'python')] },
  ruby: { nameKey: 'rb', roots: [path.join(sdkPath('ruby'), 'lib')] },
  'ruby-mcp': { nameKey: 'rb', roots: [path.join(sdkPath('rubyMcp'), 'lib')] },
  rust: { nameKey: 'rust', roots: [path.join(sdkPath('rust'), 'src')] },
  'rust-mcp': { nameKey: 'rust', roots: [path.join(sdkPath('rustMcp'), 'src')] },
  typescript: {
    nameKey: 'ts',
    roots: [
      path.join(sdkPath('typescript'), 'auth', 'src'),
      path.join(sdkPath('typescript'), 'core', 'src'),
      path.join(sdkPath('typescript'), 'next', 'src'),
      path.join(sdkPath('typescript'), 'react', 'src'),
      path.join(sdkPath('typescript'), 'react-supabase', 'src'),
      path.join(sdkPath('typescript'), 'server', 'src'),
    ],
  },
  'typescript-mcp': {
    nameKey: 'ts',
    roots: [
      path.join(sdkPath('typescript'), 'mcp', 'src'),
      path.join(sdkPath('typescript'), 'mcp-core', 'src'),
    ],
  },
  'wasm-edge': {
    nameKey: 'ts',
    mode: 'dts-exports',
    roots: [path.join(sdkPath('wasm'), 'pkg', 'edge', 'solvapay_wasm.d.ts')],
  },
  'wasm-browser': {
    nameKey: 'ts',
    mode: 'dts-exports',
    roots: [path.join(sdkPath('wasm'), 'pkg', 'browser', 'solvapay_wasm.d.ts')],
  },
}

const BROWSER_CAPABILITY_REASON =
  'needs secret-key transport, webhook verification, or authenticated-user resolution; compiled out of the browser profile (§7.1)'

const BROWSER_BUDGET_REASON =
  'pure-compute symbol omitted from the browser profile under the §7.8 size budget'

const CAPABILITY_NAMES = new Set(['verifyWebhook', 'resolveAuthenticatedUser'])

const BINDGEN_RUNTIME = new Set(['initSync', 'init', '__wbg_init'])

export function parseDtsExports(source: string): Set<string> {
  const names = new Set<string>()
  for (const raw of source.split('\n')) {
    const fn = raw.match(/^export (?:declare )?(?:async )?function (\w+)/)
    if (fn) {
      names.add(fn[1])
      continue
    }
    const cnst = raw.match(/^export const (\w+)/)
    if (cnst) {
      names.add(cnst[1])
      continue
    }
    const method = raw.match(/^ {2,8}([A-Za-z_][A-Za-z0-9_]*)\(/)
    if (method && method[1] !== 'free') {
      names.add(method[1])
    }
  }
  for (const runtime of BINDGEN_RUNTIME) {
    names.delete(runtime)
  }
  return names
}

export type FacadeCell =
  | { exposed: true }
  | { exposed: false; na: true }
  | { exposed: false; reason: string }

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

function isTestFile(name: string): boolean {
  return (
    name.endsWith('_test.go') ||
    name.endsWith('_test.rs') ||
    name.endsWith('.test.ts') ||
    name.endsWith('.test.tsx') ||
    name.startsWith('test_') ||
    name.endsWith('_spec.rb')
  )
}

function collectFiles(abs: string, acc: string[], skipDir: readonly string[]): void {
  if (!existsSync(abs)) {
    return
  }
  const rel = path.relative(REPO_ROOT, abs)
  if (skipDir.some(dir => rel === dir || rel.startsWith(`${dir}/`) || rel.includes(`/${dir}/`))) {
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
      collectFiles(path.join(abs, name), acc, skipDir)
    }
    return
  }
  if (isTestFile(path.basename(abs))) {
    return
  }
  if (/\.(rs|go|py|pyi|rb|rbs|ts|tsx|c|h)$/.test(abs) || abs.endsWith('.d.ts')) {
    acc.push(abs)
  }
}

const TS_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'new',
  'typeof',
  'await',
])

export function parseDeclarations(source: string, nameKey: NameKey): Set<string> {
  const names = new Set<string>()
  const take = (pattern: RegExp): void => {
    for (const match of source.matchAll(pattern)) {
      const name = match[1]
      if (name !== undefined && name.length > 0 && !TS_KEYWORDS.has(name)) {
        names.add(name)
      }
    }
  }
  switch (nameKey) {
    case 'ts':
      take(/^export (?:async )?function ([A-Za-z0-9_]+)/gm)
      take(/^export const ([A-Za-z0-9_]+)/gm)
      take(/^export class ([A-Za-z0-9_]+)/gm)
      take(/^ {2,8}(?:public )?(?:async )?([A-Za-z][A-Za-z0-9_]*)\(/gm)
      for (const match of source.matchAll(/^export \{([^}]+)\}/gm)) {
        const block = match[1] ?? ''
        for (const part of block.split(',')) {
          const alias = part
            .trim()
            .split(/\s+as\s+/)
            .pop()
            ?.trim()
          if (alias && /^[A-Za-z0-9_]+$/.test(alias)) names.add(alias)
        }
      }
      break
    case 'py':
      take(/^\s*(?:async )?def ([A-Za-z][A-Za-z0-9_]*)\(/gm)
      take(/^([A-Z][A-Z0-9_]+)(?::| =)/gm)
      break
    case 'rb':
      take(/^\s*def (?:self\.)?([A-Za-z][A-Za-z0-9_]*)/gm)
      take(/^\s*([A-Z][A-Z0-9_]+) = /gm)
      break
    case 'go':
      take(/^func(?: \([^)]+\))? ([A-Z][A-Za-z0-9_]*)\(/gm)
      break
    case 'rust':
      take(/pub (?:async )?fn ([A-Za-z0-9_]+)\(/g)
      take(/pub const ([A-Z0-9_]+)/g)
      take(/pub use [^\n]* as ([A-Za-z0-9_]+);/g)
      take(/pub use self::[A-Za-z0-9_]+ as ([A-Za-z0-9_]+);/g)
      // `pub use path::ident;` declares `ident`. The `as` form is handled above.
      take(/pub use [^{;\n]+::([A-Za-z0-9_]+);/g)
      for (const match of source.matchAll(/pub use [^{;]+\{([^}]+)\}/g)) {
        for (const part of (match[1] ?? '').split(',')) {
          const alias = part
            .trim()
            .split(/\s+as\s+/)
            .pop()
            ?.trim()
          if (alias !== undefined && /^[A-Za-z0-9_]+$/.test(alias)) names.add(alias)
        }
      }
      break
    case 'c':
      take(/"([A-Za-z][A-Za-z0-9_]*)"\s*=>/g)
      take(/pub (?:unsafe )?extern "C" fn ([A-Za-z0-9_]+)/g)
      break
  }
  return names
}

function isMcpBinding(entry: BindingSnapshot['bindings'][string]): boolean {
  return entry.section?.startsWith('MCP') === true
}

function declared(names: Set<string>, candidate: string): boolean {
  if (names.has(candidate)) return true
  // Emitters lowercase screaming-snake catalog names into function idents.
  if (/^[A-Z0-9_]+$/.test(candidate) && names.has(candidate.toLowerCase())) return true
  return false
}

function browserGapReason(name: string, clientMethods: Set<string>): string {
  if (CAPABILITY_NAMES.has(name) || clientMethods.has(name)) {
    return BROWSER_CAPABILITY_REASON
  }
  return BROWSER_BUDGET_REASON
}

function loadNames(facade: FacadeId): Set<string> {
  const spec = FACADE_SCAN[facade]
  const files: string[] = []
  for (const root of spec.roots) {
    collectFiles(root, files, spec.skipDir ?? [])
  }
  const names = new Set<string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const found =
      spec.mode === 'dts-exports'
        ? parseDtsExports(source)
        : parseDeclarations(source, spec.nameKey)
    for (const name of found) names.add(name)
  }
  return names
}

function isMcpFacade(facade: FacadeId): boolean {
  return facade.endsWith('-mcp')
}

const RETIRED_REASONS = new Set([
  'mcp-only facade; this op is exposed on the language SDK, not the MCP package',
  'C ABI client dispatch (`solvapay_client_call`) covers HTTP ops; this helper is not in the C table',
  'not re-exported from the `solvapay` rust facade crate; call `solvapay-core` or another language SDK',
  'not on the Go public facade; the WASI guest or contract harness may still bind it internally',
  'capability-separated browser profile (§7.1): requires the `edge` Cargo feature (transport client / secret key / webhook), compiled out of `pkg/browser`',
  'not on the edge wasm-bindgen surface',
])

function cellReason(cell: FacadeCell | undefined): string | undefined {
  if (cell === undefined || cell.exposed || 'na' in cell) return undefined
  const reason = cell.reason.trim()
  if (reason === '' || RETIRED_REASONS.has(reason)) return undefined
  return reason
}

export function buildFacadeCoverage(
  snapshot: BindingSnapshot,
  previous: FacadeCoverageFile | null,
): FacadeCoverageFile {
  const names = Object.fromEntries(FACADES.map(id => [id, loadNames(id)])) as Record<
    FacadeId,
    Set<string>
  >
  const edgeClientMethods = parseDtsExports(
    existsSync(FACADE_SCAN['wasm-edge'].roots[0] ?? '')
      ? readFileSync(FACADE_SCAN['wasm-edge'].roots[0] ?? '', 'utf8')
      : '',
  )
  const ops: FacadeCoverageFile['ops'] = {}
  for (const [opId, entry] of Object.entries(snapshot.bindings).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const row = {} as Record<FacadeId, FacadeCell>
    const candidates = [opId, entry.rustFnName, ...Object.values(entry.names)].filter(
      (name): name is string => typeof name === 'string' && name.length > 0,
    )
    for (const facade of FACADES) {
      if (isMcpFacade(facade) && !isMcpBinding(entry)) {
        row[facade] = { exposed: false, na: true }
        continue
      }
      const exposed = candidates.some(name => declared(names[facade], name))
      if (exposed) {
        row[facade] = { exposed: true }
        continue
      }
      if (facade === 'wasm-browser') {
        const label = entry.names.ts ?? opId
        row[facade] = { exposed: false, reason: browserGapReason(label, edgeClientMethods) }
        continue
      }
      const prior = cellReason(previous?.ops[opId]?.[facade])
      row[facade] =
        prior === undefined ? { exposed: false, reason: '' } : { exposed: false, reason: prior }
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
      if (cell.exposed === false && !('na' in cell) && cell.reason.trim() === '') {
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
