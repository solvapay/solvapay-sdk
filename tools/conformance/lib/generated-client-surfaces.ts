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
  const source = readFileSync(
    path.join(repoRoot, 'sdks/python/python/solvapay/_native.py'),
    'utf8',
  )
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
  const source = readFileSync(
    path.join(repoRoot, 'sdks/rust/src/client_generated.rs'),
    'utf8',
  )
  return quotedStrings(source, /pub async fn ([a-z0-9_]+)\(/g)
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
