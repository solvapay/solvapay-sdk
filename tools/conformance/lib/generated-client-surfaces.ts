/**
 * Read generated client method names from language facades for parity:check.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SdkContractManifest } from '../../shared/manifest-schema.js'
import type { Language } from '../../shared/manifest-schema.js'
import type { ParityIssue } from './parity.js'

function quotedStrings(source: string, pattern: RegExp): Set<string> {
  const out = new Set<string>()
  for (const match of source.matchAll(pattern)) {
    const value = match[1]
    if (value !== undefined) out.add(value)
  }
  return out
}

export function readPyClientMethods(repoRoot: string): Set<string> {
  const source = readFileSync(path.join(repoRoot, 'sdks/python/python/solvapay/_native.py'), 'utf8')
  const block = source.match(/ClientMethod = Literal\[([\s\S]*?)\]/)
  if (block === null || block[1] === undefined) {
    throw new Error('Python _native.py is missing ClientMethod')
  }
  return quotedStrings(block[1], /"([a-z0-9_]+)"/g)
}

export function readRbClientMethods(repoRoot: string): Set<string> {
  const source = readFileSync(path.join(repoRoot, 'sdks/ruby/lib/solvapay/_native.rb'), 'utf8')
  const block = source.match(/CLIENT_METHODS = %w\[([\s\S]*?)\]/)
  if (block === null || block[1] === undefined) {
    throw new Error('Ruby _native.rb is missing CLIENT_METHODS')
  }
  return new Set(
    block[1]
      .split(/\s+/)
      .map(item => item.trim())
      .filter(item => item.length > 0),
  )
}

export function readGoClientMethods(repoRoot: string): Set<string> {
  const source = readFileSync(path.join(repoRoot, 'sdks/go/internal/dispatch/dispatch.go'), 'utf8')
  return quotedStrings(source, /\{"([A-Z][A-Za-z0-9]+)",/g)
}

export function readCClientMethods(repoRoot: string): Set<string> {
  const source = readFileSync(
    path.join(repoRoot, 'sdks/capi/ctest/signature_parity_generated.c'),
    'utf8',
  )
  const block = source.match(/static const char \*kOps\[\] = \{([\s\S]*?)\};/)
  if (block === null || block[1] === undefined) {
    throw new Error('C signature_parity_generated.c is missing kOps')
  }
  return quotedStrings(block[1], /"([A-Za-z][A-Za-z0-9]*)"/g)
}

export function readRustClientMethods(repoRoot: string): Set<string> {
  const source = readFileSync(path.join(repoRoot, 'sdks/rust/src/client_generated.rs'), 'utf8')
  return quotedStrings(source, /pub async fn ([a-z0-9_]+)\(/g)
}

export interface McpSurfaceRead {
  symbols: Set<string>
  hasCallEnvelope: boolean
}

function addPascalAndCamel(symbols: Set<string>, name: string): void {
  symbols.add(name)
  if (name.length > 0) {
    symbols.add(name[0].toUpperCase() + name.slice(1))
  }
}

/** wasm-bindgen js_name camelCase ↔ catalog `names.rust` snake_case. */
function camelToSnake(name: string): string {
  return name.replace(/[A-Z]/g, ch => `_${ch.toLowerCase()}`).replace(/^_/, '')
}

export function readRbHelpers(repoRoot: string): Set<string> {
  const source = readFileSync(
    path.join(repoRoot, 'sdks/ruby/lib/solvapay/helpers.generated.rb'),
    'utf8',
  )
  const names = quotedStrings(source, /def self\.([a-z0-9_]+)/g)
  for (const match of source.matchAll(/^  ([A-Z][A-Z0-9_]+) = /gm)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return names
}

export function readGoHelpers(repoRoot: string): Set<string> {
  const source = readFileSync(path.join(repoRoot, 'sdks/go/helpers_generated.go'), 'utf8')
  return quotedStrings(source, /func ([A-Z][A-Za-z0-9_]*)\(ctx/g)
}

export function readRustHelpers(repoRoot: string): Set<string> {
  const source = readFileSync(path.join(repoRoot, 'sdks/rust/src/helpers_generated.rs'), 'utf8')
  const names = quotedStrings(source, /pub use solvapay_core::(?:[a-z0-9_:]+::)?([A-Za-z0-9_]+);/g)
  for (const match of source.matchAll(/ as ([A-Za-z0-9_]+);/g)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return names
}

export function readPyHelpers(repoRoot: string): Set<string> {
  const source = readFileSync(
    path.join(repoRoot, 'sdks/python/python/solvapay/helpers.generated.py'),
    'utf8',
  )
  const names = quotedStrings(source, /^def ([a-z0-9_]+)\(/gm)
  for (const match of source.matchAll(/_CONSTANT_IDS = frozenset\(\{([\s\S]*?)\}\)/g)) {
    const block = match[1]
    if (block === undefined) continue
    for (const name of quotedStrings(block, /"([A-Z0-9_]+)"/g)) {
      names.add(name)
    }
  }
  return names
}

export function readTsMcpSymbols(repoRoot: string): McpSurfaceRead {
  const native = readFileSync(
    path.join(repoRoot, 'sdks/typescript/mcp-core/src/native-mcp.ts'),
    'utf8',
  )
  const dispatch = readFileSync(
    path.join(repoRoot, 'sdks/typescript/mcp-core/src/native-mcp-dispatch.ts'),
    'utf8',
  )
  const generated = readFileSync(
    path.join(repoRoot, 'sdks/typescript/mcp-core/src/native-mcp.generated.ts'),
    'utf8',
  )
  const source = `${native}\n${dispatch}\n${generated}`
  const symbols = quotedStrings(source, /\| '([^']+)'/g)
  for (const match of source.matchAll(/export function ([A-Za-z][A-Za-z0-9]*)\(/g)) {
    if (match[1] !== undefined) symbols.add(match[1])
  }
  return {
    symbols,
    hasCallEnvelope: source.includes('callMcpSyncOp'),
  }
}

export function readPyMcpSymbols(repoRoot: string): McpSurfaceRead {
  const builders = readFileSync(path.join(repoRoot, 'sdks/python/src/payload_builders.rs'), 'utf8')
  const lib = readFileSync(path.join(repoRoot, 'sdks/python/src/lib.rs'), 'utf8')
  const symbols = quotedStrings(builders, /#\[pyfunction\(name = "([^"]+)"\)\]/g)
  return { symbols, hasCallEnvelope: lib.includes('fn solvapay_call') }
}

export function readRbMcpSymbols(repoRoot: string): McpSurfaceRead {
  const register = readFileSync(
    path.join(repoRoot, 'sdks/ruby/ext/solvapay/src/register.rs'),
    'utf8',
  )
  const lib = readFileSync(path.join(repoRoot, 'sdks/ruby/ext/solvapay/src/lib.rs'), 'utf8')
  const symbols = quotedStrings(register, /define_singleton_method\(\s*"([^"]+)"/g)
  return { symbols, hasCallEnvelope: lib.includes('fn solvapay_call') }
}

export function readGoMcpSymbols(repoRoot: string): McpSurfaceRead {
  const dispatch = readFileSync(
    path.join(repoRoot, 'sdks/go/internal/contract/dispatch.go'),
    'utf8',
  )
  const core = readFileSync(path.join(repoRoot, 'sdks/go/mcp/core.go'), 'utf8')
  const symbols = new Set<string>()
  for (const name of quotedStrings(dispatch, /"([A-Za-z][A-Za-z0-9_]+)"\s*:/g)) {
    addPascalAndCamel(symbols, name)
  }
  return { symbols, hasCallEnvelope: core.includes('CallSync') }
}

export function readRustMcpSymbols(repoRoot: string): McpSurfaceRead {
  const source = readFileSync(path.join(repoRoot, 'sdks/wasm/src/payload_builders.rs'), 'utf8')
  const lib = readFileSync(path.join(repoRoot, 'sdks/wasm/src/lib.rs'), 'utf8')
  const symbols = quotedStrings(source, /js_name = "([^"]+)"/g)
  for (const jsName of [...symbols]) {
    const snake = camelToSnake(jsName)
    if (snake !== jsName) symbols.add(snake)
  }
  for (const match of source.matchAll(/pub fn ([a-z0-9_]+)\(/g)) {
    const fn = match[1]
    if (fn === undefined) continue
    symbols.add(fn)
    if (fn.endsWith('_binding')) {
      symbols.add(fn.slice(0, -'_binding'.length))
    }
  }
  return { symbols, hasCallEnvelope: lib.includes('solvapay_call') }
}

export function readCMcpSymbols(repoRoot: string): McpSurfaceRead {
  const source = readFileSync(path.join(repoRoot, 'core/solvapay-mcp/src/sync_dispatch.rs'), 'utf8')
  return {
    symbols: quotedStrings(source, /"([A-Za-z][A-Za-z0-9]+)"\s*=>/g),
    hasCallEnvelope: false,
  }
}

export function checkGeneratedClientMethods(
  manifest: SdkContractManifest,
  methods: Set<string>,
  lang: Exclude<Language, 'ts'>,
): ParityIssue[] {
  const issues: ParityIssue[] = []
  for (const [id, entry] of Object.entries(manifest.operations)) {
    const name = entry.names[lang]
    if (typeof name !== 'string' || name.length === 0) {
      issues.push({
        kind: 'missing',
        message: `Missing: operations.${id} has no ${lang} name`,
      })
      continue
    }
    if (!methods.has(name)) {
      issues.push({
        kind: 'missing',
        message: `Missing: operations.${id} ${lang} client method "${name}"`,
      })
    }
  }
  return issues
}
