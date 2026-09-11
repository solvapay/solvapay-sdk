import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHANGESET_DIR,
  CODEGEN_DIR,
  CONFORMANCE_DIR,
  CONTRACT_DIR,
  DOCS_DIR,
  EXAMPLES_DIR,
  findRepoRoot,
  INTERNAL_DIR,
  REPO_ROOT,
  REPO_TOOLS_DIR,
  CORE_DIR,
  SHARED_DIR,
  SDK_SURFACES,
  SDKS_TYPESCRIPT_DIR,
  TOOLS_DIR,
  WORKFLOWS_DIR,
  sdkDir,
} from './paths.js'

describe('findRepoRoot', () => {
  it('should locate repo root by walking up to pnpm-workspace.yaml', () => {
    const start = path.join(REPO_ROOT, 'tools', 'shared')
    expect(findRepoRoot(start)).toBe(REPO_ROOT)
  })

  it('should throw when no marker exists above the start dir', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'solvapay-paths-'))
    try {
      expect(() => findRepoRoot(dir)).toThrow(/pnpm-workspace\.yaml/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('should resolve REPO_ROOT to the dir holding the solvapay-sdk-monorepo package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      name: string
    }
    expect(pkg.name).toBe('solvapay-sdk-monorepo')
  })
})

const LAYOUT_DIRS = {
  CONTRACT_DIR,
  CORE_DIR,
  INTERNAL_DIR,
  SDKS_TYPESCRIPT_DIR,
  DOCS_DIR,
  EXAMPLES_DIR,
  TOOLS_DIR,
  SHARED_DIR,
  CODEGEN_DIR,
  CONFORMANCE_DIR,
  REPO_TOOLS_DIR,
  WORKFLOWS_DIR,
  CHANGESET_DIR,
} as const

describe('layout directories', () => {
  it.each(Object.entries(LAYOUT_DIRS))(
    '%s is absolute, under REPO_ROOT, and exists',
    (_name, dir) => {
      expect(path.isAbsolute(dir)).toBe(true)
      expect(dir.startsWith(REPO_ROOT + path.sep) || dir === REPO_ROOT).toBe(true)
      expect(existsSync(dir)).toBe(true)
    },
  )
})

describe('sdkDir', () => {
  it('resolves every SDK surface to an existing directory', () => {
    expect(SDK_SURFACES).toHaveLength(8)
    for (const surface of SDK_SURFACES) {
      const dir = sdkDir(surface)
      expect(path.isAbsolute(dir)).toBe(true)
      expect(dir.startsWith(REPO_ROOT + path.sep)).toBe(true)
      expect(existsSync(dir), dir).toBe(true)
    }
  })
})
