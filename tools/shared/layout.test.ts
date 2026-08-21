import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { joinRoot, REPO_PATHS } from './paths.js'

describe('tools layout', () => {
  it('declares tools/ and its four buckets', () => {
    expect(REPO_PATHS.dirs.tools).toBe('tools')
    expect(REPO_PATHS.dirs.toolsShared).toBe('tools/shared')
    expect(REPO_PATHS.dirs.toolsCodegen).toBe('tools/codegen')
    expect(REPO_PATHS.dirs.toolsConformance).toBe('tools/conformance')
    expect(REPO_PATHS.dirs.toolsRepo).toBe('tools/repo')
  })

  it('declares core/ for the semantic crates', () => {
    expect(REPO_PATHS.dirs.core).toBe('core')
    expect(existsSync(joinRoot('core/solvapay-core'))).toBe(true)
    expect(existsSync(joinRoot('core/solvapay-dto'))).toBe(true)
    expect(existsSync(joinRoot('core/solvapay-transport'))).toBe(true)
  })

  it('points language SDKs at sdks/', () => {
    expect(REPO_PATHS.sdks.rust).toBe('sdks/rust')
    expect(REPO_PATHS.sdks.capi).toBe('sdks/capi')
    expect(REPO_PATHS.sdks['node-native']).toBe('sdks/node-native')
    expect(REPO_PATHS.sdks.wasm).toBe('sdks/wasm')
    expect(REPO_PATHS.sdks.python).toBe('sdks/python')
    expect(REPO_PATHS.sdks.ruby).toBe('sdks/ruby')
    expect(REPO_PATHS.sdks.go).toBe('sdks/go')
    expect(REPO_PATHS.sdks.typescript).toBe('packages/server')
  })

  it('has no top-level scripts/ directory', () => {
    expect(existsSync(joinRoot('scripts'))).toBe(false)
  })

  it('has no top-level rust/ directory', () => {
    expect(existsSync(joinRoot('rust'))).toBe(false)
  })
})
