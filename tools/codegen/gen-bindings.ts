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

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { renderYamlFragment } from './lib/manifest-edit.js'
import { bindingStubFields, clientBindingsFromYaml, nextClientEmitOrder } from './lib/binding-stub.js'
import { isDirectRun, parseErrorResult, runScriptMain, type CliResult } from './lib/cli.js'
import {
  SdkContractManifestSchema,
  type SdkContractManifest,
} from '../shared/manifest-schema.js'
import { REPO_ROOT } from '../shared/paths.js'
import { contractInputPath, generatedEntry, lookupPath } from '../shared/repo-paths.js'

const DEFAULT_MANIFEST = contractInputPath('sdkManifest')
const DEFAULT_SCHEMA_TS = lookupPath('manifestSchemaTs')

export interface CliOptions {
  mode: 'suggest' | 'fix'
  manifestPath: string
  schemaTsPath: string
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

function orphanOperationIds(
  manifest: SdkContractManifest,
  derivedBindings?: Record<string, { catalog: { kind: string; id?: string } }>,
): string[] {
  const linked = new Set<string>()
  for (const symbol of Object.values(derivedBindings ?? {})) {
    if (symbol.catalog.kind === 'operation' && symbol.catalog.id !== undefined) {
      linked.add(symbol.catalog.id)
    }
  }
  return Object.keys(manifest.operations)
    .filter(id => !linked.has(id))
    .sort((a, b) => a.localeCompare(b))
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
  const pathRefs = op.params
    .filter((p): p is typeof p & { type: 'string' } => 'type' in p && p.type === 'string')
    .map(p => p.name)
  const bodyParam = op.params.find(
    (p): p is typeof p & { ref: string } => 'ref' in p && typeof p.ref === 'string',
  )
  return bindingStubFields({
    id: opId,
    method: op.route?.method ?? 'POST',
    routePath: op.route?.path ?? '',
    pathRefs,
    bodyParamName: bodyParam?.name,
    dtoType: op.request ?? bodyParam?.ref,
    emitOrder,
  })
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
  const snapshotPath = path.join(REPO_ROOT, ...generatedEntry('bindingSymbols').path.split('/'))
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
    bindings: Record<string, { catalog: { kind: string; id?: string } }>
  }
  const orphans = orphanOperationIds(manifest, snapshot.bindings)
  if (orphans.length === 0) {
    return {
      exitCode: 0,
      stdout: 'No orphan operation bindings — reconciliation already green\n',
      stderr: '',
    }
  }

  if (options.mode === 'fix') {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Orphan operations (add #[solvapay_export] on SolvaPayClient, not YAML bindings:): ${orphans.join(', ')}\n`,
    }
  }

  let emitOrder = nextClientEmitOrder(clientBindingsFromYaml(parsed))
  const stubs: Array<{ id: string; stub: Record<string, unknown> }> = []
  for (const id of orphans) {
    stubs.push({ id, stub: suggestBindingStub(manifest, id, emitOrder) })
    emitOrder += 1
  }

  const yaml = stubs.map(({ id, stub }) => `  ${id}:\n${renderYamlFragment(stub, 4)}`).join('')
  return {
    exitCode: 0,
    stdout:
      `Suggested #[solvapay_export] targets for ${stubs.length} orphan operation(s).\n` +
      `Annotate SolvaPayClient methods; do not add YAML bindings:.\n\n` +
      yaml,
    stderr: '',
  }
}

export async function runCli(argv: string[]): Promise<CliResult> {
  let options: CliOptions
  try {
    options = parseArgs(argv)
  } catch (error) {
    return parseErrorResult(error, printUsage())
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

if (isDirectRun(import.meta.url, process.argv[1])) {
  void runScriptMain(runCli)
}
