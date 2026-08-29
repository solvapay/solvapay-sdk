/**
 * Docs must not cite pnpm scripts that no longer exist.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../shared/paths.js'

const PNPM_BUILTINS = new Set([
  'add',
  'audit',
  'changeset',
  'config',
  'create',
  'dlx',
  'env',
  'exec',
  'import',
  'install',
  'list',
  'outdated',
  'pack',
  'publish',
  'rebuild',
  'remove',
  'run',
  'store',
  'update',
  'why',
])

/** Genuine prose examples that are not repo scripts (command-shaped illustrations). */
const ALLOWLIST = new Set<string>([
  'overrides', // pnpm config key, not a script
  'build:wasm', // @solvapay/server-wasm workspace script, cited without --filter
  'test:types', // @solvapay/server workspace script, cited without --filter
])

type ScriptHit = {
  file: string
  line: number
  script: string
  filter?: string
}

function walkDocs(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'api' || name === 'node_modules') continue
      out.push(...walkDocs(full))
      continue
    }
    if (name.endsWith('.md') || name.endsWith('.mdx')) {
      out.push(full)
    }
  }
  return out
}

const INVOCATION =
  /pnpm(?:\s+--filter\s+'?(?<filter>[^\s']+)'?|\s+-F\s+'?(?<filterF>[^\s']+)'?)?(?:\s+-r)?(?:\s+--if-present)?\s+(?<script>[A-Za-z][A-Za-z0-9:_-]*)/g

function extractHits(file: string, source: string): ScriptHit[] {
  const rel = path.relative(REPO_ROOT, file)
  const hits: ScriptHit[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    INVOCATION.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = INVOCATION.exec(line)) !== null) {
      const script = match.groups?.script
      if (script === undefined) continue
      hits.push({
        file: rel,
        line: i + 1,
        script,
        filter: match.groups?.filter ?? match.groups?.filterF,
      })
    }
  }
  return hits
}

function rootScripts(): Record<string, string> {
  const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  return raw.scripts ?? {}
}

function walkPackageJson(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'target' || name === '.git') {
      continue
    }
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walkPackageJson(full, acc)
    } else if (name === 'package.json') {
      acc.push(full)
    }
  }
  return acc
}

function workspaceScripts(filter: string): Record<string, string> | undefined {
  for (const pkgPath of walkPackageJson(REPO_ROOT)) {
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      name?: string
      scripts?: Record<string, string>
    }
    if (raw.name === filter) return raw.scripts ?? {}
  }
  return undefined
}

describe('doc script references', () => {
  it('every pnpm <script> in docs exists in package.json', () => {
    const scripts = rootScripts()
    const docsRoot = path.join(REPO_ROOT, 'docs')
    const missing: string[] = []
    for (const file of walkDocs(docsRoot)) {
      for (const hit of extractHits(file, readFileSync(file, 'utf8'))) {
        if (PNPM_BUILTINS.has(hit.script) || ALLOWLIST.has(hit.script)) continue
        if (hit.filter !== undefined) {
          const ws = workspaceScripts(hit.filter)
          if (ws !== undefined && hit.script in ws) continue
          if (hit.script in scripts) continue
          missing.push(`${hit.file}:${hit.line} pnpm --filter ${hit.filter} ${hit.script}`)
          continue
        }
        if (hit.script in scripts) continue
        missing.push(`${hit.file}:${hit.line} pnpm ${hit.script}`)
      }
    }
    expect(missing, missing.join('\n')).toEqual([])
  })
})
