import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../shared/paths.js'
import {
  discoverMcpFixtureRels,
  extractFixtureRels,
  extractQuotedSkipFns,
  replayListDrift,
  typescriptCoreReplaySkipsAsync,
  C_SKIP_FNS,
  HTTP_ENGINE_FILES,
  httpEngineExcludesInvokeHandler,
  RUST_CORE_SKIP_FNS,
} from './mcp-fixture-coverage.js'
import { readFileSync } from 'node:fs'
import { joinRoot } from '../../shared/paths.js'

describe('mcp fixture coverage', () => {
  it('fails when a language frozen list omits a corpus file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mcp-coverage-'))
    writeFileSync(
      path.join(root, 'partial.ts'),
      `const MCP_AUTHORING_FIXTURES = ['allow/respond-minimal.json']\n`,
    )
    const got = extractFixtureRels(readFileSync(path.join(root, 'partial.ts'), 'utf8'))
    expect(got).toEqual(['allow/respond-minimal.json'])
    expect(got).not.toContain('dispatch/rpc.json')
  })

  it('fails when TypeScript core-replay early-returns on async ops', () => {
    const skipping = `
      switch (fn) {
        case 'mcpBootstrap':
        case 'mcpHandleRequest':
        case 'mcpResume':
        case 'mcpCallBuiltinTool':
        case 'mcpNarrate':
        case 'mcpOauthRequest':
        case 'mcpDispatch':
          return
        default:
          throw new Error(fn)
      }
    `
    expect(typescriptCoreReplaySkipsAsync(skipping)).toBe(true)
    expect(
      typescriptCoreReplaySkipsAsync(
        "case 'mcpNarrate': got = callMcpSyncOp('mcpNarrate', args); break",
      ),
    ).toBe(false)
  })

  it('every language frozen list matches the corpus', () => {
    const corpus = discoverMcpFixtureRels()
    expect(replayListDrift(REPO_ROOT, corpus)).toEqual([])
  })

  it('TypeScript core-replay asserts async MCP ops', () => {
    const source = readFileSync(joinRoot('tools/conformance/mcp-authoring/core-replay.ts'), 'utf8')
    expect(typescriptCoreReplaySkipsAsync(source)).toBe(false)
  })

  it('C replay skips only registerPayable', () => {
    const source = readFileSync(joinRoot('sdks/capi/ctest/replay_fixtures.py'), 'utf8')
    expect(extractQuotedSkipFns(source)).toEqual([...C_SKIP_FNS])
  })

  it('Rust core replay skips only host/async client ops', () => {
    const source = readFileSync(joinRoot('core/solvapay-mcp/src/fixture_replay.rs'), 'utf8')
    expect(extractQuotedSkipFns(source)).toEqual([...RUST_CORE_SKIP_FNS].sort())
  })

  it('HTTP engine suites exclude invoke-handler.json', () => {
    for (const rel of HTTP_ENGINE_FILES) {
      const source = readFileSync(joinRoot(rel), 'utf8')
      expect(httpEngineExcludesInvokeHandler(source), rel).toBe(true)
    }
  })
})
