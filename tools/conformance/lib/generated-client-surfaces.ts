/**
 * Read generated client method names from language facades for parity:check.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
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
  const source = ['sdks/rust/src/client_generated.rs', 'sdks/rust/src/blocking_generated.rs']
    .map(rel => readFileSync(path.join(repoRoot, rel), 'utf8'))
    .join('\n')
  return quotedStrings(source, /pub (?:async )?fn ([a-z0-9_]+)\(/g)
}

export interface McpSurfaceRead {
  symbols: Set<string>
}

function readTree(root: string, include: (name: string) => boolean): string {
  if (!existsSync(root)) {
    return ''
  }
  const chunks: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__pycache__' || entry.name === 'target') continue
        walk(full)
        continue
      }
      if (include(entry.name)) chunks.push(readFileSync(full, 'utf8'))
    }
  }
  walk(root)
  return chunks.join('\n')
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
  return { symbols }
}

/** Public Python MCP package plus the SDK package (integrator-visible defs). */
export function readPyMcpSymbols(repoRoot: string): McpSurfaceRead {
  const source = [
    path.join(repoRoot, 'sdks/python-mcp/python/solvapay_mcp'),
    path.join(repoRoot, 'sdks/python/python/solvapay'),
  ]
    .map(root => readTree(root, name => name.endsWith('.py') && !name.startsWith('test_')))
    .join('\n')
  return { symbols: quotedStrings(source, /^def ([A-Za-z][A-Za-z0-9_]*)\(/gm) }
}

/** Public Ruby MCP library, not the Magnus extension shim. */
export function readRbMcpSymbols(repoRoot: string): McpSurfaceRead {
  const source = readTree(path.join(repoRoot, 'sdks/ruby-mcp/lib'), name => name.endsWith('.rb'))
  return {
    symbols: quotedStrings(source, /^\s*def (?:self\.)?([A-Za-z][A-Za-z0-9_]*)/gm),
  }
}

/** Exported Go MCP identifiers. The conformance harness is not a facade. */
export function readGoMcpSymbols(repoRoot: string): McpSurfaceRead {
  const source = readTree(
    path.join(repoRoot, 'sdks/go/mcp'),
    name => name.endsWith('.go') && !name.endsWith('_test.go'),
  )
  return { symbols: quotedStrings(source, /^func ([A-Z][A-Za-z0-9_]*)\(/gm) }
}

/** Public rust-mcp crate. Not the wasm tree. */
export function readRustMcpSymbols(repoRoot: string): McpSurfaceRead {
  const source = readTree(
    path.join(repoRoot, 'sdks/rust-mcp/src'),
    name => name.endsWith('.rs') && !name.endsWith('_test.rs'),
  )
  const symbols = quotedStrings(source, /pub (?:async )?fn ([A-Za-z0-9_]+)\(/g)
  for (const match of source.matchAll(/pub use .*::([A-Za-z0-9_]+);/g)) {
    if (match[1] !== undefined) symbols.add(match[1])
  }
  for (const match of source.matchAll(/pub use self::[A-Za-z0-9_]+ as ([A-Za-z0-9_]+);/g)) {
    if (match[1] !== undefined) symbols.add(match[1])
  }
  return { symbols }
}

export function readCMcpSymbols(repoRoot: string): McpSurfaceRead {
  const source = [
    readFileSync(path.join(repoRoot, 'core/solvapay-mcp/src/sync_dispatch.rs'), 'utf8'),
    readFileSync(path.join(repoRoot, 'core/solvapay-mcp/src/sync_dispatch.generated.rs'), 'utf8'),
  ].join('\n')
  return {
    symbols: quotedStrings(source, /"([A-Za-z][A-Za-z0-9]+)"\s*=>/g),
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
