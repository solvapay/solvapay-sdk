/**
 * Rebuild and verify artifacts owned by external toolchains
 * (`externalGenerated:` in contract/manifest/repo-paths.yaml).
 *
 *   pnpm generated:external
 *   pnpm generated:external --rebuild --id capiHeader,capiFixtureHostHeader
 *   pnpm generated:external --markers-only
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../shared/paths.js'
import { loadRepoPathsManifest } from '../shared/repo-paths.js'
import type { ExternalGeneratedEntry, RepoPathsManifest } from '../shared/repo-paths-schema.js'
import { isDirectRun, parseErrorResult, runScriptMain, type CliResult } from './lib/cli.js'
import { hasMarker } from './lib/generated-marker.js'

export interface CommandCall {
  command: string
  cwd: string
}

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type CommandRunner = (command: string, cwd: string) => CommandResult

export interface MarkerCheckIssue {
  rel: string
  reason: 'unmarked'
}

export interface VerifyResult {
  id: string
  status: 'ok' | 'fail' | 'warn'
  message: string
}

export interface PlanExternalOptions {
  ids?: string[]
}

export interface HashRegistryRow {
  hash: string
  path: string
}

export interface ExternalCliDeps {
  manifest?: Pick<RepoPathsManifest, 'externalGenerated'> & { sha256Registry?: string }
  root?: string
  runCommand?: CommandRunner
  readFile?: (rel: string) => string
  hashRegistryText?: string
  digest?: (rel: string) => string
  writeRegistry?: (text: string) => void
}

const USAGE = `Usage:
  pnpm generated:external [--rebuild] [--id a,b] [--markers-only] [--update-hashes]
`

function absCwd(root: string, cwd: string | undefined): string {
  if (cwd === undefined) {
    return root
  }
  return path.join(root, ...cwd.split('/'))
}

export function planExternal(
  manifest: Pick<RepoPathsManifest, 'externalGenerated'>,
  options: PlanExternalOptions = {},
): ExternalGeneratedEntry[] {
  const ids = options.ids
  if (ids === undefined || ids.length === 0) {
    return [...manifest.externalGenerated]
  }
  return ids.map(id => {
    const entry = manifest.externalGenerated.find(item => item.id === id)
    if (entry === undefined) {
      const valid = manifest.externalGenerated.map(item => item.id).join(', ')
      throw new Error(`unknown externalGenerated artifact id: ${id} (valid: ${valid})`)
    }
    return entry
  })
}

export function checkMarkers(
  entry: ExternalGeneratedEntry,
  readFile: (rel: string) => string,
): MarkerCheckIssue[] {
  if (entry.marker === null) {
    return []
  }
  const issues: MarkerCheckIssue[] = []
  for (const rel of entry.paths) {
    if (!hasMarker(readFile(rel), entry.marker)) {
      issues.push({ rel, reason: 'unmarked' })
    }
  }
  return issues
}

const HASH_LINE = /^([0-9a-f]{64}) {2}(.+)$/

export function parseHashRegistry(text: string): HashRegistryRow[] {
  const rows: HashRegistryRow[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue
    }
    const match = HASH_LINE.exec(line)
    if (match === null || match[1] === undefined || match[2] === undefined) {
      throw new Error(`malformed hash registry line: ${line}`)
    }
    rows.push({ hash: match[1], path: match[2] })
  }
  return rows
}

export function formatHashRegistry(rows: HashRegistryRow[]): string {
  const sorted = [...rows].sort((a, b) => a.path.localeCompare(b.path))
  return `${sorted.map(row => `${row.hash}  ${row.path}`).join('\n')}\n`
}

export function isBinaryArtifact(entry: ExternalGeneratedEntry, rel: string): boolean {
  return entry.binary || rel.endsWith('.wasm')
}

export function checkBinaryHashes(
  entries: ExternalGeneratedEntry[],
  registry: Map<string, string>,
  digest: (rel: string) => string,
): VerifyResult[] {
  const declared = new Map<string, ExternalGeneratedEntry>()
  for (const entry of entries) {
    for (const rel of entry.paths) {
      if (isBinaryArtifact(entry, rel)) {
        declared.set(rel, entry)
      }
    }
  }
  const results: VerifyResult[] = []
  for (const [rel, entry] of declared) {
    const expected = registry.get(rel)
    if (expected === undefined) {
      results.push({
        id: entry.id,
        status: 'fail',
        message: `undeclared binary artifact: ${rel}`,
      })
      continue
    }
    const actual = digest(rel)
    if (actual === expected) {
      continue
    }
    results.push({
      id: entry.id,
      status: entry.nonDeterministic ? 'warn' : 'fail',
      message: `${rel} hash mismatch: registry=${expected} actual=${actual}`,
    })
  }
  for (const [rel] of registry) {
    if (!declared.has(rel)) {
      results.push({
        id: rel,
        status: 'fail',
        message: `hash registry path is not a declared binary artifact: ${rel}`,
      })
    }
  }
  return results
}

function forbidHits(entry: ExternalGeneratedEntry, readFile: (rel: string) => string): string[] {
  const hits: string[] = []
  for (const rule of entry.forbidPatterns) {
    if (readFile(rule.path).includes(rule.pattern)) {
      hits.push(rule.reason)
    }
  }
  return hits
}

export function verifyEntry(
  entry: ExternalGeneratedEntry,
  runner: CommandRunner,
  root: string,
  deps: { readFile?: (rel: string) => string } = {},
): VerifyResult {
  const readFile =
    deps.readFile ?? (rel => readFileSync(path.join(root, ...rel.split('/')), 'utf8'))
  const cwd = absCwd(root, entry.cwd)
  const command =
    entry.verify === 'command'
      ? (entry.verifyCommand ??
        (() => {
          throw new Error(`verifyCommand missing for ${entry.id}`)
        })())
      : `git diff --exit-code -- ${entry.paths.join(' ')}`
  const ran = runner(command, entry.verify === 'command' ? cwd : root)
  const forbids = forbidHits(entry, readFile)
  if (forbids.length > 0) {
    return { id: entry.id, status: 'fail', message: forbids.join('\n') }
  }
  if (ran.exitCode === 0) {
    return { id: entry.id, status: 'ok', message: ran.stdout }
  }
  const message = `drift in ${entry.id}; rebuild with: ${entry.generator}\n${ran.stdout}${ran.stderr}`
  if (entry.nonDeterministic) {
    return { id: entry.id, status: 'warn', message }
  }
  return { id: entry.id, status: 'fail', message }
}

export function interpretResults(results: VerifyResult[]): CliResult {
  const warns = results.filter(item => item.status === 'warn')
  const fails = results.filter(item => item.status === 'fail')
  const stdout = results
    .filter(item => item.status === 'ok')
    .map(item => `OK: ${item.id}`)
    .join('\n')
  const stderr = [...warns, ...fails]
    .map(item => `${item.status}: ${item.id}\n${item.message}`)
    .join('\n')
  return {
    exitCode: fails.length > 0 ? 1 : 0,
    stdout: stdout === '' ? '' : `${stdout}\n`,
    stderr: stderr === '' ? '' : `${stderr}\n`,
  }
}

export interface ExternalCliOptions {
  ids: string[]
  markersOnly: boolean
  rebuild: boolean
  updateHashes: boolean
}

export function parseArgs(argv: string[]): ExternalCliOptions {
  const ids: string[] = []
  let markersOnly = false
  let rebuild = false
  let updateHashes = false
  for (const arg of argv) {
    if (arg === '--markers-only') {
      markersOnly = true
      continue
    }
    if (arg === '--rebuild') {
      rebuild = true
      continue
    }
    if (arg === '--update-hashes') {
      updateHashes = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      throw new Error(USAGE.trim())
    }
    if (arg.startsWith('--id=')) {
      ids.push(...arg.slice('--id='.length).split(',').filter(Boolean))
      continue
    }
    if (arg === '--id') {
      throw new Error('Usage: --id a,b')
    }
    if (arg.startsWith('--id')) {
      throw new Error(`Unknown argument: ${arg}`)
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  // Support `--id a,b` as two argv tokens.
  return { ids, markersOnly, rebuild, updateHashes }
}

function parseArgsWithIdValue(argv: string[]): ExternalCliOptions {
  const normalized: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--id') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('Usage: --id a,b')
      }
      normalized.push(`--id=${value}`)
      i += 1
      continue
    }
    normalized.push(arg)
  }
  return parseArgs(normalized)
}

function defaultRunner(command: string, cwd: string): CommandResult {
  const result = spawnSync(command, { cwd, encoding: 'utf8', shell: true })
  if (result.error) {
    return { exitCode: 1, stdout: result.stdout ?? '', stderr: result.error.message }
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function defaultReadFile(root: string): (rel: string) => string {
  return rel => readFileSync(path.join(root, ...rel.split('/')), 'utf8')
}

function defaultDigest(root: string): (rel: string) => string {
  return rel =>
    createHash('sha256')
      .update(readFileSync(path.join(root, ...rel.split('/'))))
      .digest('hex')
}

function registryPath(
  manifest: Pick<RepoPathsManifest, 'externalGenerated'> & { sha256Registry?: string },
): string | undefined {
  return manifest.sha256Registry
}

function loadRegistryText(
  manifest: Pick<RepoPathsManifest, 'externalGenerated'> & { sha256Registry?: string },
  root: string,
  deps: ExternalCliDeps,
): string | undefined {
  if (deps.hashRegistryText !== undefined) {
    return deps.hashRegistryText
  }
  const rel = registryPath(manifest)
  if (rel === undefined) {
    return undefined
  }
  return readFileSync(path.join(root, ...rel.split('/')), 'utf8')
}

function binaryRows(
  entries: ExternalGeneratedEntry[],
  digest: (rel: string) => string,
): HashRegistryRow[] {
  const rows: HashRegistryRow[] = []
  for (const entry of entries) {
    for (const rel of entry.paths) {
      if (isBinaryArtifact(entry, rel)) {
        rows.push({ hash: digest(rel), path: rel })
      }
    }
  }
  return rows
}

export function runCli(argv: string[], deps: ExternalCliDeps = {}): CliResult {
  let options: ExternalCliOptions
  try {
    options = parseArgsWithIdValue(argv)
  } catch (error) {
    return parseErrorResult(error, USAGE)
  }

  const manifest = deps.manifest ?? loadRepoPathsManifest()
  const root = deps.root ?? REPO_ROOT
  const runCommand = deps.runCommand ?? defaultRunner
  const readFile = deps.readFile ?? defaultReadFile(root)
  const digest = deps.digest ?? defaultDigest(root)

  let entries: ExternalGeneratedEntry[]
  try {
    entries = planExternal(manifest, { ids: options.ids })
  } catch (error) {
    return parseErrorResult(error, USAGE)
  }

  if (options.updateHashes) {
    const rel = registryPath(manifest)
    if (rel === undefined) {
      return parseErrorResult(new Error('sha256Registry is not declared in the manifest'), USAGE)
    }
    const text = formatHashRegistry(binaryRows(manifest.externalGenerated, digest))
    const write =
      deps.writeRegistry ?? (body => writeFileSync(path.join(root, ...rel.split('/')), body))
    write(text)
  }

  const markerFails: string[] = []
  for (const entry of entries) {
    for (const issue of checkMarkers(entry, readFile)) {
      markerFails.push(`  unmarked: ${issue.rel}`)
    }
  }
  if (markerFails.length > 0) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `missing generated marker:\n${markerFails.join('\n')}\n`,
    }
  }

  const registryText = loadRegistryText(manifest, root, deps)
  const hashResults =
    registryText === undefined
      ? []
      : checkBinaryHashes(
          manifest.externalGenerated,
          new Map(parseHashRegistry(registryText).map(row => [row.path, row.hash])),
          digest,
        )

  if (options.markersOnly) {
    const forbidResults: VerifyResult[] = []
    for (const entry of entries) {
      const hits = forbidHits(entry, readFile)
      if (hits.length > 0) {
        forbidResults.push({ id: entry.id, status: 'fail', message: hits.join('\n') })
      }
    }
    return interpretResults([...forbidResults, ...hashResults])
  }

  const results: VerifyResult[] = [...hashResults]
  for (const entry of entries) {
    if (options.rebuild) {
      const generated = runCommand(entry.generator, absCwd(root, entry.cwd))
      if (generated.exitCode !== 0 && !entry.nonDeterministic) {
        results.push({
          id: entry.id,
          status: 'fail',
          message: `generator failed: ${entry.generator}\n${generated.stdout}${generated.stderr}`,
        })
        continue
      }
    }
    results.push(verifyEntry(entry, runCommand, root, { readFile }))
  }
  return interpretResults(results)
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(async argv => runCli(argv))
}
