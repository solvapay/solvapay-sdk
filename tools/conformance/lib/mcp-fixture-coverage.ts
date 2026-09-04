/**
 * Shared MCP fixture corpus discovery + per-language frozen-list equality.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { lookupPath } from '../../shared/repo-paths.js'

const FIXTURE_PATH = /[a-z0-9-]+\/[a-z0-9-]+\.json/g

export const MCP_REPLAY_LIST_FILES = [
  'tools/conformance/mcp-authoring/mcp-authoring-fixtures.test.ts',
  'sdks/python-mcp/tests/mcp_authoring/test_mcp_authoring_fixtures.py',
  'sdks/go/mcp/fixtures_test.go',
  'sdks/ruby-mcp/test/mcp_authoring_fixtures_test.rb',
  'sdks/rust-mcp/tests/mcp_authoring_fixtures.rs',
] as const

export const RUST_CORE_SKIP_FNS = [
  'registerPayable',
  'mcpBootstrap',
  'mcpCallBuiltinTool',
  'mcpOauthRequest',
  'mcpDispatch',
  'mcpResolveAuth',
] as const

export const C_SKIP_FNS = ['registerPayable'] as const

export const HTTP_ENGINE_FILES = [
  'sdks/rust-mcp/tests/mcp_authoring_fixtures.rs',
  'sdks/capi/ctest/replay_fixtures.py',
  'sdks/python-mcp/tests/mcp_authoring/test_mcp_authoring_fixtures.py',
  'sdks/ruby-mcp/test/mcp_authoring_fixtures_test.rb',
  'sdks/typescript/mcp/__tests__/engine-http-fixtures.unit.test.ts',
] as const

export const HTTP_ENGINE_INVOKE_HANDLER_EXCLUSION = 'invoke-handler.json'

export type ReplayListDrift = {
  file: string
  missing: string[]
  extra: string[]
}

function discoverFixtureFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...discoverFixtureFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(full)
    }
  }
  return files.sort()
}

export function discoverMcpFixtureRels(repoRoot?: string): string[] {
  const root =
    repoRoot === undefined
      ? lookupPath('mcpFixtures')
      : path.join(repoRoot, 'contract/mcp-fixtures')
  return discoverFixtureFiles(root).map(file => path.relative(root, file).split(path.sep).join('/'))
}

export function extractFixtureRels(source: string): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(FIXTURE_PATH)) {
    found.add(match[0])
  }
  return [...found].sort()
}

export function replayListDrift(repoRoot: string, corpus: readonly string[]): ReplayListDrift[] {
  const want = [...corpus]
  const drifts: ReplayListDrift[] = []
  for (const rel of MCP_REPLAY_LIST_FILES) {
    const source = readFileSync(path.join(repoRoot, rel), 'utf8')
    const got = extractFixtureRels(source)
    const missing = want.filter(item => !got.includes(item))
    const extra = got.filter(item => !want.includes(item))
    if (missing.length > 0 || extra.length > 0) {
      drifts.push({ file: rel, missing, extra })
    }
  }
  return drifts
}

export function typescriptCoreReplaySkipsAsync(source: string): boolean {
  return /case 'mcpBootstrap':\s*case 'mcpHandleRequest':/.test(source.replace(/\s+/g, ' '))
}

export function extractQuotedSkipFns(source: string): string[] {
  const block = source.match(/matches!\(\s*fn_name,\s*([\s\S]*?)\)/)
  if (block === null || block[1] === undefined) {
    const cSkip = source.match(/SKIP_FNS\s*=\s*\{([^}]+)\}/)
    if (cSkip === null || cSkip[1] === undefined) return []
    return [...cSkip[1].matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]).sort()
  }
  return [...block[1].matchAll(/"([A-Za-z]+)"/g)].map(match => match[1]).sort()
}

export function httpEngineExcludesInvokeHandler(source: string): boolean {
  return (
    source.includes(HTTP_ENGINE_INVOKE_HANDLER_EXCLUSION) &&
    /not rel\.endswith\("invoke-handler\.json"\)|!rel\.end_with\?\("invoke-handler\.json"\)|rel\.ends_with\("invoke-handler\.json"\)[\s\S]{0,80}continue|rel\.endsWith\(['"]invoke-handler\.json['"]\)[\s\S]{0,80}continue|!rel\.endsWith\(['"]invoke-handler\.json['"]\)|strings\.HasSuffix\(rel, "invoke-handler\.json"\)/.test(
      source,
    )
  )
}
