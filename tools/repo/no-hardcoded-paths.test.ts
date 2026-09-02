import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOOLS_DIR } from '../shared/paths.js'

const ALLOWLIST = new Set([
  'shared/paths.ts',
  'shared/repo-paths.ts',
  'shared/repo-paths-schema.ts',
  'shared/paths.test.ts',
  'shared/repo-paths-manifest.test.ts',
  'shared/layout.test.ts',
  'shared/ts-packages.test.ts',
  'shared/cargo-layout.test.ts',
  'shared/bucket-boundaries.test.ts',
  'repo/lib/referenced-paths.ts',
  'repo/no-hardcoded-paths.test.ts',
  'repo/check-referenced-paths.test.ts',
  'repo/package-locality.test.ts',
  'conformance/wasm-fixture-server.mjs',
  'conformance/lib/mcp-fixture-coverage.ts',
  'conformance/lib/mcp-fixture-coverage.test.ts',
  'conformance/lib/mcp-layer3-budget.ts',
  'conformance/lib/mcp-layer3-budget.test.ts',
  'conformance/lib/public-surface.test.ts',
  'conformance/lib/generated-client-surfaces.ts',
  'conformance/lib/surface-loc-budget.ts',
  'codegen/manifest.test.ts',
  'repo/lib/release-train.test.ts',
  'repo/prettierignore.test.ts',
  'repo/doc-script-references.test.ts',
  'mcp-app-widget/__tests__/widget-artifact.test.ts',
])

const ROOT_ARITHMETIC = [/dirname\(\s*fileURLToPath\(\s*import\.meta\.url/, /\b__dirname\b/]

const HARDCODED_PATH =
  /['"`]((?:rust|packages|sdks|core|internal|contract|docs|examples|scripts|tools|\.github)\/[^'"`\n]+)/g

const HARDCODED_JOIN =
  /\bjoin\(\s*[^)]*?['"`](packages|sdks|core|internal|tools|contract|docs|examples)['"`]/g

function stripComments(src: string): string {
  const withoutBlock = src.replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
  return withoutBlock
    .split('\n')
    .map(line => {
      const trimmed = line.trimStart()
      if (trimmed.startsWith('//')) {
        return ''
      }
      return line
    })
    .join('\n')
}

const PUBLISHED_TOOL_PACKAGES = new Set(['cli', 'create-solvapay', 'init'])

function listTools(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'target' || name === 'node_modules') {
        continue
      }
      if (dir === TOOLS_DIR && PUBLISHED_TOOL_PACKAGES.has(name)) {
        continue
      }
      // Rust crates live inside tools/ buckets after the hoist; they are not TS.
      if (existsSync(path.join(full, 'Cargo.toml'))) {
        continue
      }
      listTools(full, acc)
      continue
    }
    if (name.endsWith('.ts') || name.endsWith('.mjs')) {
      acc.push(full)
    }
  }
  return acc
}

function rel(file: string): string {
  return path.relative(TOOLS_DIR, file).split(path.sep).join('/')
}

describe('no hardcoded repo paths in tools/', () => {
  it('has no root arithmetic or layout string literals outside the allowlist', () => {
    const violations: string[] = []
    for (const file of listTools(TOOLS_DIR)) {
      const key = rel(file)
      if (ALLOWLIST.has(key)) {
        continue
      }
      const src = stripComments(readFileSync(file, 'utf8'))
      if (ROOT_ARITHMETIC.some(pattern => pattern.test(src))) {
        violations.push(`${key}: root arithmetic via fileURLToPath/__dirname`)
      }
      HARDCODED_PATH.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = HARDCODED_PATH.exec(src)) !== null) {
        violations.push(`${key}: hardcoded path ${match[1]}`)
      }
      HARDCODED_JOIN.lastIndex = 0
      while ((match = HARDCODED_JOIN.exec(src)) !== null) {
        violations.push(`${key}: hardcoded join(${match[1]})`)
      }
    }
    expect(violations).toEqual([])
  })
})
