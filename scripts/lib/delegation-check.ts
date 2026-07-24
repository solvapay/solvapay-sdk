/**
 * Binding delegation inventory gate (Step 37R-e; edge markers added Step 38R-f).
 *
 * Enumerates value exports of `@solvapay/server` + `@solvapay/core`, resolves
 * each symbol's defining module (following re-export chains), and requires a
 * delegation marker — or an allowlist entry with a permitted reason.
 *
 * A definition file counts as delegating when it routes through either binding:
 * the Node napi path (`dispatchClient` / `dispatchSync` / `callNative` /
 * `callNativeSync` / `verifyWebhookNative`) or the edge WASM path
 * (`callWasm` / `callWasmSync` / `verifyWebhookWasm`). Most shared definition
 * files (e.g. `client.ts`, `native-decisions.ts`) carry the dispatch marker that
 * fans out to both, so this list is a superset that also recognizes files that
 * only reach the WASM binding directly.
 */

import path from 'node:path'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

export const DELEGATION_MARKERS = [
  'dispatchClient',
  'dispatchSync',
  'callNative',
  'callNativeSync',
  'verifyWebhookNative',
  // Edge WASM binding delegation (Step 38R-f).
  'callWasm',
  'callWasmSync',
  'verifyWebhookWasm',
] as const

export const PERMITTED_ALLOWLIST_REASONS = [
  'section-8-exclusion',
  'host-orchestration-decisions-delegated',
  'type-guard-or-const',
  'binding-infra',
  /** Core decision / helper bodies kept as portable TS; Node hits them via server native-decisions. */
  'portable-ts-fallback',
] as const

export type PermittedAllowlistReason = (typeof PERMITTED_ALLOWLIST_REASONS)[number]

export type PackageName = '@solvapay/server' | '@solvapay/core'

export type AllowlistEntry = {
  package: PackageName
  symbol: string
  reason: string
}

export type DelegationAllowlist = {
  entries: AllowlistEntry[]
}

export type ExportInventoryEntry = {
  package: PackageName
  symbol: string
  /** Absolute path to the resolved definition file (or entry if local). */
  definitionFile: string
  /** Source text scanned for markers (definition file + re-export chain). */
  sourceText: string
}

export type DelegationIssue = {
  kind: 'missing-marker' | 'stale-allowlist' | 'invalid-reason'
  package: string
  symbol: string
  file?: string
  message: string
}

const MARKER_RE = new RegExp(`\\b(?:${DELEGATION_MARKERS.join('|')})\\b`)

export function hasDelegationMarker(sourceText: string): boolean {
  return MARKER_RE.test(sourceText)
}

export function checkDelegation(
  inventory: readonly ExportInventoryEntry[],
  allowlist: DelegationAllowlist,
): DelegationIssue[] {
  const issues: DelegationIssue[] = []
  const allowByKey = new Map<string, AllowlistEntry>()

  for (const entry of allowlist.entries) {
    const key = `${entry.package}::${entry.symbol}`
    if (!PERMITTED_ALLOWLIST_REASONS.includes(entry.reason as PermittedAllowlistReason)) {
      issues.push({
        kind: 'invalid-reason',
        package: entry.package,
        symbol: entry.symbol,
        message: `allowlist reason "${entry.reason}" for ${entry.package}.${entry.symbol} is not permitted (expected one of: ${PERMITTED_ALLOWLIST_REASONS.join(', ')})`,
      })
    }
    allowByKey.set(key, entry)
  }

  const inventoryKeys = new Set<string>()
  for (const exp of inventory) {
    const key = `${exp.package}::${exp.symbol}`
    inventoryKeys.add(key)
    const allowed = allowByKey.has(key)
    if (allowed) continue
    if (!hasDelegationMarker(exp.sourceText)) {
      issues.push({
        kind: 'missing-marker',
        package: exp.package,
        symbol: exp.symbol,
        file: exp.definitionFile,
        message: `export ${exp.package}.${exp.symbol} has no delegation marker in ${exp.definitionFile} and is not allowlisted`,
      })
    }
  }

  for (const entry of allowlist.entries) {
    const key = `${entry.package}::${entry.symbol}`
    if (!inventoryKeys.has(key)) {
      issues.push({
        kind: 'stale-allowlist',
        package: entry.package,
        symbol: entry.symbol,
        message: `allowlist entry ${entry.package}.${entry.symbol} is stale — symbol is not a public value export`,
      })
    }
  }

  return issues
}

export function formatDelegationReport(issues: readonly DelegationIssue[]): string {
  if (issues.length === 0) return 'delegation-check: OK'
  const lines = issues.map(i => {
    const loc = i.file ? ` (${i.file})` : ''
    return `  [${i.kind}] ${i.package}.${i.symbol}${loc}: ${i.message}`
  })
  return `delegation-check: ${issues.length} issue(s)\n${lines.join('\n')}`
}

function loadProgram(entryFiles: string[], compilerOptions: ts.CompilerOptions): ts.Program {
  return ts.createProgram(entryFiles, {
    ...compilerOptions,
    noEmit: true,
    skipLibCheck: true,
  })
}

function isValueExport(symbol: ts.Symbol): boolean {
  const flags = symbol.getFlags()
  // Alias to a type-only export — exclude.
  if ((flags & ts.SymbolFlags.Alias) !== 0) {
    // Resolved below; treat as value unless all declarations are type-only.
  }
  if ((flags & ts.SymbolFlags.Value) !== 0) return true
  if ((flags & ts.SymbolFlags.Type) !== 0 && (flags & ts.SymbolFlags.Value) === 0) {
    return false
  }
  // Fallback: inspect declarations.
  const decls = symbol.getDeclarations() ?? []
  if (decls.length === 0) return true
  return decls.some(
    d =>
      !ts.isTypeAliasDeclaration(d) &&
      !ts.isInterfaceDeclaration(d) &&
      !(ts.isExportSpecifier(d) && d.isTypeOnly),
  )
}

/**
 * Follow export { X } from './mod' chains to the value declaration.
 * Only the resolved definition file is scanned for markers — never the package
 * entry alone, which would false-positive on install/dispatch wiring present
 * in `index.ts`.
 */
function resolveDefinitionSources(
  program: ts.Program,
  entryFile: string,
  exportName: string,
): { definitionFile: string; sourceText: string } {
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(entryFile)
  if (sf === undefined) {
    return { definitionFile: entryFile, sourceText: '' }
  }

  const modSymbol = checker.getSymbolAtLocation(sf)
  if (modSymbol === undefined) {
    return { definitionFile: entryFile, sourceText: sf.getFullText() }
  }

  let symbol = checker.getExportsOfModule(modSymbol).find(e => e.getName() === exportName)
  if (symbol === undefined) {
    return { definitionFile: entryFile, sourceText: sf.getFullText() }
  }

  // Walk aliases / re-exports to the value declaration.
  for (let depth = 0; depth < 12; depth += 1) {
    if ((symbol.getFlags() & ts.SymbolFlags.Alias) !== 0) {
      const aliased = checker.getAliasedSymbol(symbol)
      if (aliased === symbol) break
      symbol = aliased
    }

    const decls = symbol.getDeclarations() ?? []
    if (decls.length === 0) break

    const decl = decls[0]
    if (decl === undefined) break

    // Prefer a real value declaration over an export specifier.
    if (
      ts.isFunctionDeclaration(decl) ||
      ts.isClassDeclaration(decl) ||
      ts.isVariableDeclaration(decl) ||
      ts.isMethodDeclaration(decl) ||
      ts.isVariableStatement(decl)
    ) {
      const declSf = decl.getSourceFile()
      return {
        definitionFile: path.normalize(declSf.fileName),
        sourceText: declSf.getFullText(),
      }
    }

    if (ts.isExportSpecifier(decl)) {
      continue
    }

    const declSf = decl.getSourceFile()
    return {
      definitionFile: path.normalize(declSf.fileName),
      sourceText: declSf.getFullText(),
    }
  }

  const decls = symbol.getDeclarations() ?? []
  const decl = decls[0]
  if (decl !== undefined) {
    const declSf = decl.getSourceFile()
    return {
      definitionFile: path.normalize(declSf.fileName),
      sourceText: declSf.getFullText(),
    }
  }

  return { definitionFile: entryFile, sourceText: sf.getFullText() }
}

function valueExportsOf(program: ts.Program, filePath: string): string[] {
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(filePath)
  if (sf === undefined) return []
  const modSymbol = checker.getSymbolAtLocation(sf)
  if (modSymbol === undefined) return []

  const names: string[] = []
  for (const exp of checker.getExportsOfModule(modSymbol)) {
    if (exp.getName() === 'default') continue
    let resolved = exp
    if ((exp.getFlags() & ts.SymbolFlags.Alias) !== 0) {
      resolved = checker.getAliasedSymbol(exp)
    }
    if (!isValueExport(resolved) && !isValueExport(exp)) continue
    // Skip pure type aliases even if the export specifier itself looks like a value.
    const flags = resolved.getFlags()
    if ((flags & ts.SymbolFlags.Type) !== 0 && (flags & ts.SymbolFlags.Value) === 0) continue
    names.push(exp.getName())
  }
  return names.sort()
}

export function loadAllowlist(filePath: string): DelegationAllowlist {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('entries' in raw) ||
    !Array.isArray((raw as DelegationAllowlist).entries)
  ) {
    throw new Error(`delegation-check: invalid allowlist at ${filePath}`)
  }
  return raw as DelegationAllowlist
}

/**
 * Build the live export inventory from package source entry points.
 */
export function buildExportInventory(repoRoot: string): ExportInventoryEntry[] {
  const serverEntry = path.join(repoRoot, 'packages/server/src/index.ts')
  const coreEntry = path.join(repoRoot, 'packages/core/src/index.ts')

  const configPath = ts.findConfigFile(
    path.join(repoRoot, 'packages/server'),
    ts.sys.fileExists,
    'tsconfig.json',
  )
  const config = configPath
    ? ts.parseJsonConfigFileContent(
        ts.readConfigFile(configPath, ts.sys.readFile).config,
        ts.sys,
        path.dirname(configPath),
      )
    : {
        options: {
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          strict: true,
        },
      }

  const program = loadProgram([serverEntry, coreEntry], config.options)
  const inventory: ExportInventoryEntry[] = []

  for (const [pkg, entry] of [
    ['@solvapay/server', serverEntry],
    ['@solvapay/core', coreEntry],
  ] as const) {
    for (const symbol of valueExportsOf(program, entry)) {
      const resolved = resolveDefinitionSources(program, entry, symbol)
      inventory.push({
        package: pkg,
        symbol,
        definitionFile: resolved.definitionFile,
        sourceText: resolved.sourceText,
      })
    }
  }

  return inventory
}

export function runDelegationCheck(repoRoot: string, allowlistPath: string): DelegationIssue[] {
  const inventory = buildExportInventory(repoRoot)
  const allowlist = loadAllowlist(allowlistPath)
  return checkDelegation(inventory, allowlist)
}
