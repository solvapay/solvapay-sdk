/**
 * Suggest or apply missing `bindings:` stubs for orphan catalog operations.
 *
 * Modes:
 *   (default) / --suggest   Print YAML stubs for missing operation binders.
 *   --fix                  Insert stubs into sdk-contract.yaml and add
 *                           missing names to SHIM_JS_NAMES.
 *
 * Descriptors are derived from catalog operation params / route (not Rust AST —
 * that is a gated later phase). Humans still review core path, serialize mode,
 * and docs.
 *
 * Full workflow: docs/contributing/sdk-codegen.md (Workflow B).
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  insertIntoStringArrayConst,
  insertSectionEntry,
  renderYamlFragment,
  sectionBounds,
} from './lib/manifest-edit.js'
import {
  deriveNames,
  SdkContractManifestSchema,
  toSnakeCase,
  type SdkContractManifest,
} from './lib/manifest-schema.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'contract/manifest/sdk-contract.yaml')
const DEFAULT_SCHEMA_TS = path.join(REPO_ROOT, 'scripts/lib/manifest-schema.ts')

export interface CliOptions {
  mode: 'suggest' | 'fix'
  manifestPath: string
  schemaTsPath: string
}

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
}

function printUsage(): string {
  return `Usage:
  pnpm gen:bindings
  pnpm gen:bindings --suggest
  pnpm gen:bindings --fix
`
}

export function parseArgs(argv: string[]): CliOptions {
  let mode: 'suggest' | 'fix' = 'suggest'
  let manifestPath = DEFAULT_MANIFEST
  let schemaTsPath = DEFAULT_SCHEMA_TS

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--suggest') {
      mode = 'suggest'
      continue
    }
    if (arg === '--fix') {
      mode = 'fix'
      continue
    }
    if (arg === '--manifest') {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) {
        throw new Error('--manifest requires a path')
      }
      manifestPath = path.resolve(next)
      i += 1
      continue
    }
    if (arg === '--help' || arg === '-h') {
      throw new Error(printUsage().trim())
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return { mode, manifestPath, schemaTsPath }
}

function orphanOperationIds(manifest: SdkContractManifest): string[] {
  const linked = new Set<string>()
  for (const symbol of Object.values(manifest.bindings)) {
    if (symbol.catalog.kind === 'operation') {
      linked.add(symbol.catalog.id)
    }
  }
  return Object.keys(manifest.operations)
    .filter(id => !linked.has(id))
    .sort((a, b) => a.localeCompare(b))
}

function nextClientEmitOrder(manifest: SdkContractManifest): number {
  let max = -1
  for (const symbol of Object.values(manifest.bindings)) {
    if (symbol.artifact === 'client' && typeof symbol.emitOrder === 'number') {
      max = Math.max(max, symbol.emitOrder)
    }
  }
  return max + 1
}

function sectionHasEntry(text: string, sectionName: string, entryId: string): boolean {
  const { bodyStart, bodyEnd } = sectionBounds(text, sectionName)
  return new RegExp(`^  ${entryId}:\\n`, 'm').test(text.slice(bodyStart, bodyEnd))
}

export function suggestBindingStub(
  manifest: SdkContractManifest,
  opId: string,
  emitOrder: number,
): Record<string, unknown> {
  const op = manifest.operations[opId]
  if (op === undefined) {
    throw new Error(`Unknown operation: ${opId}`)
  }
  const names = deriveNames(opId)
  const snake = toSnakeCase(opId)
  const pathRefs = op.params
    .filter((p): p is typeof p & { type: 'string' } => 'type' in p && p.type === 'string')
    .map(p => p.name)
  const bodyParam = op.params.find(
    (p): p is typeof p & { ref: string } => 'ref' in p && typeof p.ref === 'string',
  )
  const dtoType = op.request ?? bodyParam?.ref
  const isSplit = pathRefs.length > 0
  const clientCallArgs = [
    ...pathRefs.map((_, i) => `&refs[${i}]`),
    ...(bodyParam !== undefined
      ? [bodyParam.name === 'overrides' ? 'Some(overrides)' : bodyParam.name]
      : []),
  ]

  return {
    core: `solvapay_transport::SolvaPayClient::${snake}`,
    names,
    catalog: { kind: 'operation', id: opId },
    args: [],
    splitPathRefs: pathRefs,
    return: 'value',
    sync: 'async',
    envelope: 'async',
    artifact: 'client',
    emitOrder,
    section: 'Group B',
    doc: `\`${op.route.method} ${op.route.path}\``,
    rustFnName: snake,
    call: {
      kind: 'wrap',
      serialize: isSplit ? 'clientSplit' : 'clientAwait',
    },
    coreCall: snake,
    ...(dtoType !== undefined ? { dtoType } : {}),
    ...(isSplit ? { clientCallArgs } : {}),
  }
}

export function runBindings(options: CliOptions): CliResult {
  const raw = readFileSync(options.manifestPath, 'utf8')
  const parsed = parseYaml(raw)
  const loaded = SdkContractManifestSchema.safeParse(parsed)
  if (!loaded.success) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Manifest schema invalid — fix schema errors before scaffolding bindings\n`,
    }
  }
  const manifest = loaded.data
  const orphans = orphanOperationIds(manifest)
  if (orphans.length === 0) {
    return {
      exitCode: 0,
      stdout: 'No orphan operation bindings — reconciliation already green\n',
      stderr: '',
    }
  }

  let emitOrder = nextClientEmitOrder(manifest)
  const stubs: Array<{ id: string; stub: Record<string, unknown> }> = []
  for (const id of orphans) {
    stubs.push({ id, stub: suggestBindingStub(manifest, id, emitOrder) })
    emitOrder += 1
  }

  if (options.mode === 'suggest') {
    const yaml = stubs.map(({ id, stub }) => `  ${id}:\n${renderYamlFragment(stub, 4)}`).join('')
    return {
      exitCode: 0,
      stdout:
        `Suggested bindings for ${stubs.length} orphan operation(s).\n` +
        `Apply with: pnpm gen:bindings --fix\n\n` +
        yaml,
      stderr: '',
    }
  }

  let nextRaw = raw
  let schemaTs = readFileSync(options.schemaTsPath, 'utf8')
  const applied: string[] = []

  for (const { id, stub } of stubs) {
    if (sectionHasEntry(nextRaw, 'bindings', id)) {
      continue
    }
    nextRaw = insertSectionEntry(nextRaw, 'bindings', id, renderYamlFragment(stub, 4))
    schemaTs = insertIntoStringArrayConst(schemaTs, 'SHIM_JS_NAMES', id)
    applied.push(id)
  }

  writeFileSync(options.manifestPath, nextRaw)
  writeFileSync(options.schemaTsPath, schemaTs)

  return {
    exitCode: 0,
    stdout:
      `Inserted bindings for: ${applied.join(', ')}\n` +
      `Updated SHIM_JS_NAMES in ${path.relative(REPO_ROOT, options.schemaTsPath)}\n` +
      `Next: pnpm gen && pnpm manifest:check\n`,
    stderr: '',
  }
}

export async function runCli(argv: string[]): Promise<CliResult> {
  let options: CliOptions
  try {
    options = parseArgs(argv)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { exitCode: 1, stdout: '', stderr: `${message}\n${printUsage()}` }
  }
  try {
    return runBindings(options)
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}

async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2))
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  process.exit(result.exitCode)
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  void main()
}
